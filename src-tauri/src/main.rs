// Prevents additional console window on Windows in release AND debug
#![windows_subsystem = "windows"]

// Include generated version from build.rs
include!(concat!(env!("OUT_DIR"), "/version.rs"));

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{State, Manager, AppHandle, GlobalShortcutManager, api::process::restart, SystemTray, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem, SystemTrayEvent};
use uuid::Uuid;
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use rdev::{listen, Event, EventType, Key};

// Global stop flag for all playing sounds
static STOP_ALL_FLAG: AtomicBool = AtomicBool::new(false);

// Global app handle for playing sounds from shortcuts
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

// Global keybind registry for low-level keyboard hook
// Maps keybind string (e.g., "Ctrl+A") to sound ID (or "STOP_ALL" for stop all)
lazy_static::lazy_static! {
    static ref KEYBIND_REGISTRY: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
    static ref PRESSED_KEYS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

// Convert rdev Key to string representation
fn key_to_string(key: Key) -> Option<String> {
    match key {
        // Letters
        Key::KeyA => Some("A".to_string()),
        Key::KeyB => Some("B".to_string()),
        Key::KeyC => Some("C".to_string()),
        Key::KeyD => Some("D".to_string()),
        Key::KeyE => Some("E".to_string()),
        Key::KeyF => Some("F".to_string()),
        Key::KeyG => Some("G".to_string()),
        Key::KeyH => Some("H".to_string()),
        Key::KeyI => Some("I".to_string()),
        Key::KeyJ => Some("J".to_string()),
        Key::KeyK => Some("K".to_string()),
        Key::KeyL => Some("L".to_string()),
        Key::KeyM => Some("M".to_string()),
        Key::KeyN => Some("N".to_string()),
        Key::KeyO => Some("O".to_string()),
        Key::KeyP => Some("P".to_string()),
        Key::KeyQ => Some("Q".to_string()),
        Key::KeyR => Some("R".to_string()),
        Key::KeyS => Some("S".to_string()),
        Key::KeyT => Some("T".to_string()),
        Key::KeyU => Some("U".to_string()),
        Key::KeyV => Some("V".to_string()),
        Key::KeyW => Some("W".to_string()),
        Key::KeyX => Some("X".to_string()),
        Key::KeyY => Some("Y".to_string()),
        Key::KeyZ => Some("Z".to_string()),
        // Numbers
        Key::Num0 => Some("0".to_string()),
        Key::Num1 => Some("1".to_string()),
        Key::Num2 => Some("2".to_string()),
        Key::Num3 => Some("3".to_string()),
        Key::Num4 => Some("4".to_string()),
        Key::Num5 => Some("5".to_string()),
        Key::Num6 => Some("6".to_string()),
        Key::Num7 => Some("7".to_string()),
        Key::Num8 => Some("8".to_string()),
        Key::Num9 => Some("9".to_string()),
        // Function keys
        Key::F1 => Some("F1".to_string()),
        Key::F2 => Some("F2".to_string()),
        Key::F3 => Some("F3".to_string()),
        Key::F4 => Some("F4".to_string()),
        Key::F5 => Some("F5".to_string()),
        Key::F6 => Some("F6".to_string()),
        Key::F7 => Some("F7".to_string()),
        Key::F8 => Some("F8".to_string()),
        Key::F9 => Some("F9".to_string()),
        Key::F10 => Some("F10".to_string()),
        Key::F11 => Some("F11".to_string()),
        Key::F12 => Some("F12".to_string()),
        // Numpad
        Key::Kp0 => Some("NUMPAD0".to_string()),
        Key::Kp1 => Some("NUMPAD1".to_string()),
        Key::Kp2 => Some("NUMPAD2".to_string()),
        Key::Kp3 => Some("NUMPAD3".to_string()),
        Key::Kp4 => Some("NUMPAD4".to_string()),
        Key::Kp5 => Some("NUMPAD5".to_string()),
        Key::Kp6 => Some("NUMPAD6".to_string()),
        Key::Kp7 => Some("NUMPAD7".to_string()),
        Key::Kp8 => Some("NUMPAD8".to_string()),
        Key::Kp9 => Some("NUMPAD9".to_string()),
        Key::KpMinus => Some("NUMPAD-".to_string()),
        Key::KpPlus => Some("NUMPAD+".to_string()),
        Key::KpMultiply => Some("NUMPAD*".to_string()),
        Key::KpDivide => Some("NUMPAD/".to_string()),
        // Special keys
        Key::Space => Some("SPACE".to_string()),
        Key::Return => Some("ENTER".to_string()),
        Key::Escape => Some("ESCAPE".to_string()),
        Key::Backspace => Some("BACKSPACE".to_string()),
        Key::Tab => Some("TAB".to_string()),
        Key::Delete => Some("DELETE".to_string()),
        Key::Insert => Some("INSERT".to_string()),
        Key::Home => Some("HOME".to_string()),
        Key::End => Some("END".to_string()),
        Key::PageUp => Some("PAGEUP".to_string()),
        Key::PageDown => Some("PAGEDOWN".to_string()),
        Key::UpArrow => Some("ARROWUP".to_string()),
        Key::DownArrow => Some("ARROWDOWN".to_string()),
        Key::LeftArrow => Some("ARROWLEFT".to_string()),
        Key::RightArrow => Some("ARROWRIGHT".to_string()),
        // Punctuation
        Key::Minus => Some("-".to_string()),
        Key::Equal => Some("=".to_string()),
        Key::LeftBracket => Some("[".to_string()),
        Key::RightBracket => Some("]".to_string()),
        Key::BackSlash => Some("\\".to_string()),
        Key::SemiColon => Some(";".to_string()),
        Key::Quote => Some("'".to_string()),
        Key::Comma => Some(",".to_string()),
        Key::Dot => Some(".".to_string()),
        Key::Slash => Some("/".to_string()),
        Key::BackQuote => Some("`".to_string()),
        // Modifiers (tracked separately)
        Key::ControlLeft | Key::ControlRight => Some("CTRL".to_string()),
        Key::ShiftLeft | Key::ShiftRight => Some("SHIFT".to_string()),
        Key::Alt | Key::AltGr => Some("ALT".to_string()),
        Key::MetaLeft | Key::MetaRight => Some("META".to_string()),
        _ => None,
    }
}

// Check if current pressed keys match a registered keybind
fn check_keybind_match() {
    let pressed = PRESSED_KEYS.lock().unwrap();
    let registry = KEYBIND_REGISTRY.lock().unwrap();

    // Build the current keybind string from pressed keys
    let mut parts: Vec<&str> = Vec::new();
    let mut main_key: Option<&str> = None;

    for key in pressed.iter() {
        match key.as_str() {
            "CTRL" => parts.push("Ctrl"),
            "SHIFT" => parts.push("Shift"),
            "ALT" => parts.push("Alt"),
            "META" => parts.push("Super"),
            k => main_key = Some(k),
        }
    }

    // If we have a main key (non-modifier), check for match
    if let Some(key) = main_key {
        // Sort modifiers for consistent matching
        parts.sort();
        parts.push(key);
        let current_combo = parts.join("+");

        // Check against registered keybinds
        for (keybind, action) in registry.iter() {
            // Normalize the registered keybind for comparison
            let normalized = normalize_keybind(keybind);
            if normalized == current_combo {
                if action == "STOP_ALL" {
                    STOP_ALL_FLAG.store(true, Ordering::SeqCst);
                } else {
                    // Play sound by ID
                    let sound_id = action.clone();
                    std::thread::spawn(move || {
                        play_sound_by_id(sound_id);
                    });
                }
                break;
            }
        }
    }
}

// Normalize keybind string for comparison
fn normalize_keybind(keybind: &str) -> String {
    let mut parts: Vec<&str> = keybind.split('+').collect();
    let main_key = parts.pop();
    parts.sort();
    if let Some(key) = main_key {
        parts.push(key);
    }
    parts.join("+")
}

// Track last detected key for debugging
lazy_static::lazy_static! {
    static ref LAST_KEY_PRESS: Mutex<Option<String>> = Mutex::new(None);
}

// Start the low-level keyboard listener in a background thread
fn start_keyboard_listener() {
    std::thread::spawn(move || {
        if let Err(error) = listen(move |event: Event| {
            match event.event_type {
                EventType::KeyPress(key) => {
                    if let Some(key_str) = key_to_string(key) {
                        // Track last key for debugging
                        if let Ok(mut last) = LAST_KEY_PRESS.lock() {
                            *last = Some(key_str.clone());
                        }

                        let mut pressed = PRESSED_KEYS.lock().unwrap();
                        pressed.insert(key_str);
                        drop(pressed);

                        // Always check for match on every key press
                        check_keybind_match();
                    }
                }
                EventType::KeyRelease(key) => {
                    if let Some(key_str) = key_to_string(key) {
                        let mut pressed = PRESSED_KEYS.lock().unwrap();
                        pressed.remove(&key_str);
                    }
                }
                _ => {}
            }
        }) {
            eprintln!("Keyboard listener error: {:?}", error);
        }
    });
}

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
    #[serde(rename = "compactMode", default)]
    compact_mode: bool,
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(rename = "minimizeToTray", default)]
    minimize_to_tray: bool,
}

fn default_theme() -> String {
    "green".to_string()
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
            compact_mode: state.compact_mode,
            theme: state.theme.clone(),
            minimize_to_tray: state.minimize_to_tray,
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
    #[serde(default)]
    order: i32,
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
    #[serde(rename = "compactMode")]
    compact_mode: bool,
    theme: String,
    #[serde(rename = "minimizeToTray")]
    minimize_to_tray: bool,
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
    compact_mode: bool,
    theme: String,
    minimize_to_tray: bool,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            sounds: HashMap::new(),
            primary_device: None,
            monitor_device: None,
            master_volume: 0.8,
            stop_all_keybind: None,
            compact_mode: false,
            theme: "green".to_string(),
            minimize_to_tray: false,
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
    let mut sounds: Vec<Sound> = audio_state.sounds.values().cloned().collect();
    sounds.sort_by_key(|s| s.order);
    sounds
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    let audio_state = state.lock().unwrap();
    Settings {
        primary_device: audio_state.primary_device.clone(),
        monitor_device: audio_state.monitor_device.clone(),
        master_volume: audio_state.master_volume,
        stop_all_keybind: audio_state.stop_all_keybind.clone(),
        compact_mode: audio_state.compact_mode,
        theme: audio_state.theme.clone(),
        minimize_to_tray: audio_state.minimize_to_tray,
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
fn set_compact_mode(enabled: bool, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.compact_mode = enabled;
    save_settings(&audio_state);
    Ok(())
}

#[tauri::command]
fn set_theme(theme: String, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.theme = theme;
    save_settings(&audio_state);
    Ok(())
}

#[tauri::command]
fn set_minimize_to_tray(enabled: bool, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    audio_state.minimize_to_tray = enabled;
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

    // Calculate order based on current sound count
    let order = {
        let audio_state = state.lock().map_err(|e| e.to_string())?;
        audio_state.sounds.len() as i32
    };

    let sound = Sound {
        id: Uuid::new_v4().to_string(),
        name,
        keybind: None,
        volume: 1.0,
        file_path,
        start_time: None,
        end_time: None,
        order,
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

#[tauri::command]
fn update_sound_order(sound_ids: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let mut audio_state = state.lock().map_err(|e| e.to_string())?;
    for (index, sound_id) in sound_ids.iter().enumerate() {
        if let Some(sound) = audio_state.sounds.get_mut(sound_id) {
            sound.order = index as i32;
        }
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
    // Register with rdev low-level listener (for games without anti-cheat)
    {
        let mut registry = KEYBIND_REGISTRY.lock().map_err(|e| e.to_string())?;
        registry.retain(|_, v| v != &sound_id);
        registry.insert(keybind.clone(), sound_id.clone());
    }

    // Also register with Tauri GlobalShortcutManager (reliable for normal apps)
    let accelerator = convert_keybind_to_accelerator(&keybind);
    let mut shortcut_manager = app_handle.global_shortcut_manager();
    let _ = shortcut_manager.unregister(&accelerator); // Ignore error if not registered

    let id = sound_id.clone();
    let _ = shortcut_manager.register(&accelerator, move || {
        play_sound_by_id(id.clone());
    });

    Ok(())
}

#[tauri::command]
fn unregister_sound_keybind(app_handle: AppHandle, keybind: String) -> Result<(), String> {
    // Unregister from rdev
    {
        let mut registry = KEYBIND_REGISTRY.lock().map_err(|e| e.to_string())?;
        registry.remove(&keybind);
    }

    // Unregister from GlobalShortcutManager
    let accelerator = convert_keybind_to_accelerator(&keybind);
    let mut shortcut_manager = app_handle.global_shortcut_manager();
    let _ = shortcut_manager.unregister(&accelerator);

    Ok(())
}

#[tauri::command]
fn register_stop_all_keybind(app_handle: AppHandle, keybind: String) -> Result<(), String> {
    // Register with rdev
    {
        let mut registry = KEYBIND_REGISTRY.lock().map_err(|e| e.to_string())?;
        registry.retain(|_, v| v != "STOP_ALL");
        registry.insert(keybind.clone(), "STOP_ALL".to_string());
    }

    // Also register with GlobalShortcutManager
    let accelerator = convert_keybind_to_accelerator(&keybind);
    let mut shortcut_manager = app_handle.global_shortcut_manager();
    let _ = shortcut_manager.unregister(&accelerator);

    let _ = shortcut_manager.register(&accelerator, || {
        STOP_ALL_FLAG.store(true, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
fn unregister_stop_all_keybind(app_handle: AppHandle, keybind: String) -> Result<(), String> {
    // Unregister from rdev
    {
        let mut registry = KEYBIND_REGISTRY.lock().map_err(|e| e.to_string())?;
        registry.remove(&keybind);
    }

    // Unregister from GlobalShortcutManager
    let accelerator = convert_keybind_to_accelerator(&keybind);
    let mut shortcut_manager = app_handle.global_shortcut_manager();
    let _ = shortcut_manager.unregister(&accelerator);

    Ok(())
}

#[tauri::command]
fn get_current_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
fn get_last_key_press() -> Option<String> {
    LAST_KEY_PRESS.lock().ok().and_then(|guard| guard.clone())
}

#[tauri::command]
fn get_registered_keybinds() -> Vec<String> {
    KEYBIND_REGISTRY.lock()
        .map(|guard| guard.keys().cloned().collect())
        .unwrap_or_default()
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

    println!("[Updater] Checking for updates... Current version: {}", VERSION);

    match builder(app_handle).check().await {
        Ok(update) => {
            println!("[Updater] Latest version from server: {}", update.latest_version());
            println!("[Updater] Update available: {}", update.is_update_available());

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
            println!("[Updater] Error checking updates: {}", e);
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
            initial_state.compact_mode = settings.compact_mode;
            initial_state.theme = settings.theme;
            initial_state.minimize_to_tray = settings.minimize_to_tray;
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

    // Clone minimize_to_tray for use in window close handler
    let minimize_to_tray_setting = initial_state.minimize_to_tray;

    let audio_state: AppState = Arc::new(Mutex::new(initial_state));
    let audio_state_for_tray = audio_state.clone();

    // Create system tray menu
    let show = CustomMenuItem::new("show".to_string(), "Show MotoBoard");
    let stop_all_menu = CustomMenuItem::new("stop_all".to_string(), "Stop All Sounds");
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(stop_all_menu)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);
    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(move |app, event| {
            match event {
                SystemTrayEvent::LeftClick { .. } => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                SystemTrayEvent::MenuItemClick { id, .. } => {
                    match id.as_str() {
                        "show" => {
                            if let Some(window) = app.get_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "stop_all" => {
                            STOP_ALL_FLAG.store(true, Ordering::SeqCst);
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        })
        .on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                // Check current minimize_to_tray setting
                let should_minimize = if let Ok(state) = audio_state_for_tray.lock() {
                    state.minimize_to_tray
                } else {
                    minimize_to_tray_setting
                };

                if should_minimize {
                    // Hide window instead of closing
                    let _ = event.window().hide();
                    api.prevent_close();
                }
            }
        })
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
            update_sound_order,
            play_sound,
            stop_all,
            register_sound_keybind,
            unregister_sound_keybind,
            register_stop_all_keybind,
            unregister_stop_all_keybind,
            set_stop_all_keybind,
            set_compact_mode,
            set_theme,
            set_minimize_to_tray,
            get_current_version,
            check_for_updates,
            install_update,
            get_last_key_press,
            get_registered_keybinds,
        ])
        .setup(move |app| {
            // Store app handle globally for use in shortcut callbacks
            let _ = APP_HANDLE.set(app.handle());

            // Start the low-level keyboard listener (for games without anti-cheat)
            start_keyboard_listener();

            // Register existing keybinds with BOTH systems
            let mut shortcut_manager = app.global_shortcut_manager();

            // Register sound keybinds
            {
                let mut registry = KEYBIND_REGISTRY.lock().unwrap();
                for (sound_id, keybind) in sounds_for_keybinds {
                    // Add to rdev registry
                    registry.insert(keybind.clone(), sound_id.clone());

                    // Add to GlobalShortcutManager
                    let accelerator = convert_keybind_to_accelerator(&keybind);
                    let id = sound_id.clone();
                    let _ = shortcut_manager.register(&accelerator, move || {
                        play_sound_by_id(id.clone());
                    });
                }

                // Register stop all keybind if saved
                if let Some(keybind) = stop_all_keybind_for_register {
                    // Add to rdev registry
                    registry.insert(keybind.clone(), "STOP_ALL".to_string());

                    // Add to GlobalShortcutManager
                    let accelerator = convert_keybind_to_accelerator(&keybind);
                    let _ = shortcut_manager.register(&accelerator, || {
                        STOP_ALL_FLAG.store(true, Ordering::SeqCst);
                    });
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
