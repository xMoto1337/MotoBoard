// Prevents additional console window on Windows in release AND debug
#![windows_subsystem = "windows"]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{State, Manager, AppHandle, GlobalShortcutManager, api::process::restart};
use uuid::Uuid;
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};

// Global stop flag for all playing sounds
static STOP_ALL_FLAG: AtomicBool = AtomicBool::new(false);

// Global app handle for playing sounds from shortcuts
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

// Check if we should persist data (only in release builds)
fn should_persist() -> bool {
    !cfg!(debug_assertions)
}

// Get the config directory for saving data
fn get_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("MotoBoard"))
}

// Ensure config directory exists
fn ensure_config_dir() -> Option<PathBuf> {
    let config_dir = get_config_dir()?;
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).ok()?;
    }
    Some(config_dir)
}

// Save sounds to file
fn save_sounds(sounds: &HashMap<String, Sound>) {
    if !should_persist() {
        return;
    }

    if let Some(config_dir) = ensure_config_dir() {
        let sounds_file = config_dir.join("sounds.json");
        let sounds_vec: Vec<&Sound> = sounds.values().collect();
        if let Ok(json) = serde_json::to_string_pretty(&sounds_vec) {
            if let Ok(mut file) = File::create(&sounds_file) {
                let _ = file.write_all(json.as_bytes());
            }
        }
    }
}

// Load sounds from file
fn load_sounds() -> HashMap<String, Sound> {
    if !should_persist() {
        return HashMap::new();
    }

    if let Some(config_dir) = get_config_dir() {
        let sounds_file = config_dir.join("sounds.json");
        if sounds_file.exists() {
            if let Ok(file) = File::open(&sounds_file) {
                if let Ok(sounds_vec) = serde_json::from_reader::<_, Vec<Sound>>(BufReader::new(file)) {
                    return sounds_vec.into_iter().map(|s| (s.id.clone(), s)).collect();
                }
            }
        }
    }
    HashMap::new()
}

// Persistent settings structure (includes UI settings)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistentSettings {
    #[serde(rename = "primaryDevice")]
    primary_device: Option<String>,
    #[serde(rename = "monitorDevice")]
    monitor_device: Option<String>,
    #[serde(rename = "masterVolume")]
    master_volume: f32,
    #[serde(rename = "stopAllKeybind")]
    stop_all_keybind: Option<String>,
}

// Save settings to file
fn save_settings(state: &AudioState) {
    if !should_persist() {
        return;
    }

    if let Some(config_dir) = ensure_config_dir() {
        let settings_file = config_dir.join("settings.json");
        let settings = PersistentSettings {
            primary_device: state.primary_device.clone(),
            monitor_device: state.monitor_device.clone(),
            master_volume: state.master_volume,
            stop_all_keybind: state.stop_all_keybind.clone(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&settings) {
            if let Ok(mut file) = File::create(&settings_file) {
                let _ = file.write_all(json.as_bytes());
            }
        }
    }
}

// Load settings from file
fn load_settings() -> Option<PersistentSettings> {
    if !should_persist() {
        return None;
    }

    if let Some(config_dir) = get_config_dir() {
        let settings_file = config_dir.join("settings.json");
        if settings_file.exists() {
            if let Ok(file) = File::open(&settings_file) {
                if let Ok(settings) = serde_json::from_reader::<_, PersistentSettings>(BufReader::new(file)) {
                    return Some(settings);
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Sound {
    id: String,
    name: String,
    keybind: Option<String>,
    volume: f32,
    #[serde(rename = "filePath")]
    file_path: String,
    #[serde(rename = "startTime")]
    start_time: Option<f64>,
    #[serde(rename = "endTime")]
    end_time: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Settings {
    #[serde(rename = "primaryDevice")]
    primary_device: Option<String>,
    #[serde(rename = "monitorDevice")]
    monitor_device: Option<String>,
    #[serde(rename = "masterVolume")]
    master_volume: f32,
    #[serde(rename = "stopAllKeybind")]
    stop_all_keybind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct AudioDevice {
    id: i32,
    name: String,
}

struct AudioState {
    sounds: HashMap<String, Sound>,
    primary_device: Option<String>,
    monitor_device: Option<String>,
    master_volume: f32,
    stop_all_keybind: Option<String>,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            sounds: HashMap::new(),
            primary_device: None,
            monitor_device: None,
            master_volume: 0.8,
            stop_all_keybind: None,
        }
    }
}

type AppState = Arc<Mutex<AudioState>>;

#[tauri::command]
fn get_audio_devices() -> Vec<AudioDevice> {
    // Use rodio's default device enumeration
    let host = rodio::cpal::default_host();
    let mut devices = Vec::new();

    use rodio::cpal::traits::{HostTrait, DeviceTrait};

    if let Ok(output_devices) = host.output_devices() {
        for (idx, device) in output_devices.enumerate() {
            if let Ok(name) = device.name() {
                devices.push(AudioDevice {
                    id: idx as i32,
                    name,
                });
            }
        }
    }

    devices
}

#[tauri::command]
fn set_primary_device(device_name: String, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.primary_device = Some(device_name);
    save_settings(&audio_state);
    Ok(())
}

#[tauri::command]
fn set_monitor_device(device_name: String, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.monitor_device = if device_name.is_empty() {
        None
    } else {
        Some(device_name)
    };
    save_settings(&audio_state);
    Ok(())
}

#[tauri::command]
fn set_master_volume(volume: f32, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.master_volume = volume.clamp(0.0, 1.0);
    save_settings(&audio_state);
    Ok(())
}

#[tauri::command]
fn get_sounds(state: State<AppState>) -> Vec<Sound> {
    let audio_state = state.lock().unwrap();
    audio_state.sounds.values().cloned().collect()
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    let audio_state = state.lock().unwrap();
    Settings {
        primary_device: audio_state.primary_device.clone(),
        monitor_device: audio_state.monitor_device.clone(),
        master_volume: audio_state.master_volume,
        stop_all_keybind: audio_state.stop_all_keybind.clone(),
    }
}

#[tauri::command]
fn set_stop_all_keybind(keybind: Option<String>, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.stop_all_keybind = keybind;
    save_settings(&audio_state);
    Ok(())
}

#[tauri::command]
fn add_sound_from_path(file_path: String, state: State<AppState>) -> Result<Sound, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();

    let sound = Sound {
        id: Uuid::new_v4().to_string(),
        name,
        keybind: None,
        volume: 1.0,
        file_path,
        start_time: None,
        end_time: None,
    };

    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.sounds.insert(sound.id.clone(), sound.clone());
    save_sounds(&audio_state.sounds);

    Ok(sound)
}

#[tauri::command]
fn remove_sound(sound_id: String, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.sounds.remove(&sound_id);
    save_sounds(&audio_state.sounds);
    Ok(())
}

#[tauri::command]
fn update_sound_keybind(
    sound_id: String,
    keybind: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    if let Some(sound) = audio_state.sounds.get_mut(&sound_id) {
        sound.keybind = keybind;
    }
    save_sounds(&audio_state.sounds);
    Ok(())
}

#[tauri::command]
fn update_sound_trim(
    sound_id: String,
    start_time: Option<f64>,
    end_time: Option<f64>,
    state: State<AppState>,
) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    if let Some(sound) = audio_state.sounds.get_mut(&sound_id) {
        sound.start_time = start_time;
        sound.end_time = end_time;
    }
    save_sounds(&audio_state.sounds);
    Ok(())
}

fn find_device_by_name(name: &str) -> Option<rodio::cpal::Device> {
    use rodio::cpal::traits::{HostTrait, DeviceTrait};

    let host = rodio::cpal::default_host();
    let name_lower = name.to_lowercase();

    host.output_devices().ok()?.find(|d| {
        d.name()
            .map(|n| n.to_lowercase().contains(&name_lower))
            .unwrap_or(false)
    })
}

fn play_on_device(
    file_path: &str,
    device_name: Option<&str>,
    volume: f32,
    start_time: Option<f64>,
    end_time: Option<f64>,
) -> Result<(), String> {
    let file = File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let source = Decoder::new(BufReader::new(file))
        .map_err(|e| format!("Failed to decode audio: {}", e))?;

    // Try to use specific device, fall back to default
    let (_stream, stream_handle): (OutputStream, OutputStreamHandle) = if let Some(name) = device_name {
        if let Some(device) = find_device_by_name(name) {
            OutputStream::try_from_device(&device)
                .map_err(|e| format!("Failed to open device: {}", e))?
        } else {
            // Fall back to default if device not found
            OutputStream::try_default()
                .map_err(|e| format!("Failed to open default device: {}", e))?
        }
    } else {
        OutputStream::try_default()
            .map_err(|e| format!("Failed to open default device: {}", e))?
    };

    let sink = Sink::try_new(&stream_handle)
        .map_err(|e| format!("Failed to create sink: {}", e))?;

    sink.set_volume(volume);

    // Apply trim settings
    let start_secs = start_time.unwrap_or(0.0);

    if let Some(end_secs) = end_time {
        if start_secs > 0.0 {
            // Skip to start time, then take duration until end time
            let duration = end_secs - start_secs;
            let trimmed = source
                .skip_duration(std::time::Duration::from_secs_f64(start_secs))
                .take_duration(std::time::Duration::from_secs_f64(duration));
            sink.append(trimmed);
        } else {
            // Just take until end time
            let trimmed = source.take_duration(std::time::Duration::from_secs_f64(end_secs));
            sink.append(trimmed);
        }
    } else if start_secs > 0.0 {
        // Just skip to start time
        let trimmed = source.skip_duration(std::time::Duration::from_secs_f64(start_secs));
        sink.append(trimmed);
    } else {
        // No trimming
        sink.append(source);
    }

    // Poll for stop signal instead of blocking until end
    while !sink.empty() {
        if STOP_ALL_FLAG.load(Ordering::SeqCst) {
            sink.stop();
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    Ok(())
}

#[tauri::command]
fn play_sound(sound_id: String, state: State<AppState>) -> Result<(), String> {
    let audio_state = state.lock().map_err(|e| e.to_string())?;

    let sound = audio_state
        .sounds
        .get(&sound_id)
        .ok_or_else(|| "Sound not found".to_string())?
        .clone();

    let file_path = sound.file_path.clone();
    if !PathBuf::from(&file_path).exists() {
        return Err("Sound file not found".to_string());
    }

    let primary_device = audio_state.primary_device.clone();
    let monitor_device = audio_state.monitor_device.clone();
    let volume = audio_state.master_volume * sound.volume;
    let start_time = sound.start_time;
    let end_time = sound.end_time;

    // Drop the lock before spawning threads
    drop(audio_state);

    // If stop flag was set (by stop_all), wait a moment for threads to stop, then reset
    if STOP_ALL_FLAG.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
        STOP_ALL_FLAG.store(false, Ordering::SeqCst);
    }

    // Play to primary device in a thread
    let file_path_primary = file_path.clone();
    let primary = primary_device.clone();
    let start_primary = start_time;
    let end_primary = end_time;
    std::thread::spawn(move || {
        let _ = play_on_device(&file_path_primary, primary.as_deref(), volume, start_primary, end_primary);
    });

    // Play to monitor device in a thread (if set and different from primary)
    if let Some(monitor) = monitor_device {
        if primary_device.as_ref() != Some(&monitor) {
            let file_path_monitor = file_path;
            std::thread::spawn(move || {
                let _ = play_on_device(&file_path_monitor, Some(&monitor), volume, start_time, end_time);
            });
        }
    }

    Ok(())
}

#[tauri::command]
fn stop_all() -> Result<(), String> {
    // Set the global stop flag to signal all playing sounds to stop
    STOP_ALL_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}

// Convert frontend keybind format to Tauri accelerator format
fn convert_keybind_to_accelerator(keybind: &str) -> String {
    // Frontend uses "Ctrl+A", Tauri uses "CmdOrCtrl+A" for cross-platform
    // But on Windows, we can just use the keybind as-is mostly
    // Just need to handle some edge cases
    keybind
        .replace("CONTROL", "Ctrl")
        .replace("SHIFT", "Shift")
        .replace("ALT", "Alt")
        .replace("META", "Super")
        .replace("SPACE", "Space")
        .replace("ARROWUP", "Up")
        .replace("ARROWDOWN", "Down")
        .replace("ARROWLEFT", "Left")
        .replace("ARROWRIGHT", "Right")
        .replace("ESCAPE", "Escape")
        .replace("ENTER", "Return")
        .replace("BACKSPACE", "Backspace")
        .replace("DELETE", "Delete")
        .replace("TAB", "Tab")
}

// Play sound by ID using the global app handle
fn play_sound_by_id(sound_id: String) {
    if let Some(app_handle) = APP_HANDLE.get() {
        let state: State<AppState> = app_handle.state();
        let audio_state = match state.lock() {
            Ok(s) => s,
            Err(_) => return,
        };

        let sound = match audio_state.sounds.get(&sound_id) {
            Some(s) => s.clone(),
            None => return,
        };

        let file_path = sound.file_path.clone();
        if !PathBuf::from(&file_path).exists() {
            return;
        }

        let primary_device = audio_state.primary_device.clone();
        let monitor_device = audio_state.monitor_device.clone();
        let volume = audio_state.master_volume * sound.volume;
        let start_time = sound.start_time;
        let end_time = sound.end_time;

        drop(audio_state);

        // Reset stop flag if needed
        if STOP_ALL_FLAG.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));
            STOP_ALL_FLAG.store(false, Ordering::SeqCst);
        }

        // Play to primary device
        let file_path_primary = file_path.clone();
        let primary = primary_device.clone();
        std::thread::spawn(move || {
            let _ = play_on_device(&file_path_primary, primary.as_deref(), volume, start_time, end_time);
        });

        // Play to monitor device
        if let Some(monitor) = monitor_device {
            if primary_device.as_ref() != Some(&monitor) {
                std::thread::spawn(move || {
                    let _ = play_on_device(&file_path, Some(&monitor), volume, start_time, end_time);
                });
            }
        }
    }
}

#[tauri::command]
fn register_sound_keybind(app_handle: AppHandle, sound_id: String, keybind: String) -> Result<(), String> {
    let accelerator = convert_keybind_to_accelerator(&keybind);

    let mut shortcut_manager = app_handle.global_shortcut_manager();

    // Unregister if already registered
    let _ = shortcut_manager.unregister(&accelerator);

    let id = sound_id.clone();
    shortcut_manager
        .register(&accelerator, move || {
            play_sound_by_id(id.clone());
        })
        .map_err(|e| format!("Failed to register keybind '{}': {}", keybind, e))?;

    Ok(())
}

#[tauri::command]
fn unregister_sound_keybind(app_handle: AppHandle, keybind: String) -> Result<(), String> {
    let accelerator = convert_keybind_to_accelerator(&keybind);

    let mut shortcut_manager = app_handle.global_shortcut_manager();
    shortcut_manager
        .unregister(&accelerator)
        .map_err(|e| format!("Failed to unregister keybind: {}", e))?;

    Ok(())
}

#[tauri::command]
fn register_stop_all_keybind(app_handle: AppHandle, keybind: String) -> Result<(), String> {
    let accelerator = convert_keybind_to_accelerator(&keybind);

    let mut shortcut_manager = app_handle.global_shortcut_manager();

    // Unregister if already registered
    let _ = shortcut_manager.unregister(&accelerator);

    shortcut_manager
        .register(&accelerator, || {
            STOP_ALL_FLAG.store(true, Ordering::SeqCst);
        })
        .map_err(|e| format!("Failed to register stop all keybind: {}", e))?;

    Ok(())
}

#[tauri::command]
fn unregister_stop_all_keybind(app_handle: AppHandle, keybind: String) -> Result<(), String> {
    let accelerator = convert_keybind_to_accelerator(&keybind);

    let mut shortcut_manager = app_handle.global_shortcut_manager();
    let _ = shortcut_manager.unregister(&accelerator);

    Ok(())
}

#[tauri::command]
fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[derive(Debug, Clone, Serialize)]
struct UpdateInfo {
    available: bool,
    version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
async fn check_for_updates(app_handle: AppHandle) -> Result<UpdateInfo, String> {
    use tauri::updater::builder;

    match builder(app_handle).check().await {
        Ok(update) => {
            if update.is_update_available() {
                Ok(UpdateInfo {
                    available: true,
                    version: Some(update.latest_version().to_string()),
                    notes: update.body().map(|s| s.to_string()),
                })
            } else {
                Ok(UpdateInfo {
                    available: false,
                    version: None,
                    notes: None,
                })
            }
        }
        Err(e) => {
            // If we can't check for updates, just report no update available
            Err(format!("Failed to check for updates: {}", e))
        }
    }
}

#[tauri::command]
async fn install_update(app_handle: AppHandle) -> Result<(), String> {
    use tauri::updater::builder;

    let update = builder(app_handle.clone())
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {}", e))?;

    if update.is_update_available() {
        update
            .download_and_install()
            .await
            .map_err(|e| format!("Failed to install update: {}", e))?;

        // Restart the app after update
        restart(&app_handle.env());
    }

    Ok(())
}

fn main() {
    // Load saved data on startup (release builds only)
    let mut initial_state = AudioState::default();

    if should_persist() {
        // Load sounds
        initial_state.sounds = load_sounds();

        // Load settings
        if let Some(settings) = load_settings() {
            initial_state.primary_device = settings.primary_device;
            initial_state.monitor_device = settings.monitor_device;
            initial_state.master_volume = settings.master_volume;
            initial_state.stop_all_keybind = settings.stop_all_keybind;
        }
    }

    // Clone stop all keybind for registering after app starts
    let stop_all_keybind_for_register = initial_state.stop_all_keybind.clone();

    // Clone sounds for registering keybinds after app starts
    let sounds_for_keybinds: Vec<(String, String)> = initial_state
        .sounds
        .iter()
        .filter_map(|(id, sound)| {
            sound.keybind.as_ref().map(|kb| (id.clone(), kb.clone()))
        })
        .collect();

    let audio_state: AppState = Arc::new(Mutex::new(initial_state));

    tauri::Builder::default()
        .manage(audio_state)
        .invoke_handler(tauri::generate_handler![
            get_audio_devices,
            set_primary_device,
            set_monitor_device,
            set_master_volume,
            get_sounds,
            get_settings,
            add_sound_from_path,
            remove_sound,
            update_sound_keybind,
            update_sound_trim,
            play_sound,
            stop_all,
            register_sound_keybind,
            unregister_sound_keybind,
            register_stop_all_keybind,
            unregister_stop_all_keybind,
            set_stop_all_keybind,
            get_current_version,
            check_for_updates,
            install_update,
        ])
        .setup(move |app| {
            // Store app handle globally for use in shortcut callbacks
            let _ = APP_HANDLE.set(app.handle());

            // Register existing keybinds from loaded sounds
            let mut shortcut_manager = app.global_shortcut_manager();
            for (sound_id, keybind) in sounds_for_keybinds {
                let accelerator = convert_keybind_to_accelerator(&keybind);
                let id = sound_id.clone();
                let _ = shortcut_manager.register(&accelerator, move || {
                    play_sound_by_id(id.clone());
                });
            }

            // Register stop all keybind if saved
            if let Some(keybind) = stop_all_keybind_for_register {
                let accelerator = convert_keybind_to_accelerator(&keybind);
                let _ = shortcut_manager.register(&accelerator, || {
                    STOP_ALL_FLAG.store(true, Ordering::SeqCst);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
