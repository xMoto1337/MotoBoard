import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import { readBinaryFile } from '@tauri-apps/api/fs'

interface Sound {
  id: string
  name: string
  keybind: string | null
  volume: number
  filePath: string
  startTime?: number
  endTime?: number
  order: number
  loopMode?: boolean
  playbackSpeed?: number
  echoDelay?: number
  echoVolume?: number
  reverbDecay?: number
  bassBoost?: number
  fakeBassBoost?: number
}

interface AudioDevice {
  id: number
  name: string
}

interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'debug' | 'warn'
}

function App() {
  const [sounds, setSounds] = useState<Sound[]>([])
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [primaryDevice, setPrimaryDevice] = useState<string>('')
  const [monitorDevice, setMonitorDevice] = useState<string>('')
  const [masterVolume, setMasterVolume] = useState(80)
  const [playingSound, setPlayingSound] = useState<string | null>(null)
  const [status, setStatus] = useState('Ready')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editingSound, setEditingSound] = useState<Sound | null>(null)
  const [stopAllKeybind, setStopAllKeybind] = useState<string>('')
  const [recordingKeybind, setRecordingKeybind] = useState<'sound' | 'stopAll' | null>(null)
  const [overlapMode, setOverlapMode] = useState(true)
  const [crossfadeDuration, setCrossfadeDuration] = useState(0)
  const [defaultVolume, setDefaultVolume] = useState(80)
  const [fadeInDuration, setFadeInDuration] = useState(0)
  const [fadeOutDuration, setFadeOutDuration] = useState(0)
  const [showConsole, setShowConsole] = useState(true)
  const [compactMode, setCompactMode] = useState(false)
  const [theme, setTheme] = useState<string>('green')
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [waveformData, setWaveformData] = useState<number[]>([])
  const [audioDuration, setAudioDuration] = useState(0)
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<'checking' | 'up-to-date' | 'update-available' | 'error'>('checking')
  const [latestVersion, setLatestVersion] = useState<string>('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [draggedSound, setDraggedSound] = useState<string | null>(null)
  const [dragOverSound, setDragOverSound] = useState<string | null>(null)
  const [soundQueue, setSoundQueue] = useState<string[]>([])
  const [isQueuePlaying, setIsQueuePlaying] = useState(false)
  const consoleRef = useRef<HTMLDivElement>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const initializedRef = useRef(false)

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date()
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false })
    setLogs(prev => [...prev.slice(-100), { timestamp, message, type }])

    setTimeout(() => {
      if (consoleRef.current) {
        consoleRef.current.scrollTop = consoleRef.current.scrollHeight
      }
    }, 10)
  }

  // Format keybind for display
  const formatKeybind = (e: KeyboardEvent): string => {
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    const key = e.key.toUpperCase()
    if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) {
      parts.push(key === ' ' ? 'Space' : key)
    }

    return parts.join('+')
  }

  // Register a global keybind for a sound
  const registerSoundKeybind = async (soundId: string, keybind: string) => {
    try {
      await invoke('register_sound_keybind', { soundId, keybind })
      addLog(`[Keybind] Registered global: ${keybind}`, 'success')
    } catch (error) {
      addLog(`[Keybind] Failed to register ${keybind}: ${error}`, 'error')
    }
  }

  // Unregister a global keybind
  const unregisterSoundKeybind = async (keybind: string) => {
    try {
      await invoke('unregister_sound_keybind', { keybind })
      addLog(`[Keybind] Unregistered: ${keybind}`, 'debug')
    } catch (error) {
      // Ignore errors when unregistering
    }
  }

  // Register stop all keybind
  const registerStopAllKeybind = async (keybind: string) => {
    try {
      await invoke('register_stop_all_keybind', { keybind })
      addLog(`[Keybind] Stop All registered: ${keybind}`, 'success')
    } catch (error) {
      addLog(`[Keybind] Failed to register Stop All: ${error}`, 'error')
    }
  }

  // Unregister stop all keybind
  const unregisterStopAllKeybind = async (keybind: string) => {
    try {
      await invoke('unregister_stop_all_keybind', { keybind })
      addLog(`[Keybind] Stop All unregistered`, 'debug')
    } catch (error) {
      // Ignore errors when unregistering
    }
  }

  // Global keyboard listener - only for recording keybinds now
  const handleGlobalKeyDown = useCallback(async (e: KeyboardEvent) => {
    // Only handle if recording a keybind
    if (!recordingKeybind) return

    // Ignore if only a modifier key is pressed (wait for the actual key)
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      return
    }

    e.preventDefault()
    const keybind = formatKeybind(e)

    if (recordingKeybind === 'stopAll') {
      // Unregister old keybind if exists
      if (stopAllKeybind) {
        await unregisterStopAllKeybind(stopAllKeybind)
      }
      setStopAllKeybind(keybind)
      await registerStopAllKeybind(keybind)
      // Save to backend
      await invoke('set_stop_all_keybind', { keybind })
    } else if (recordingKeybind === 'sound' && editingSound) {
      // Unregister old keybind if exists
      if (editingSound.keybind) {
        await unregisterSoundKeybind(editingSound.keybind)
      }
      setEditingSound({ ...editingSound, keybind })
      await registerSoundKeybind(editingSound.id, keybind)
    }
    setRecordingKeybind(null)
  }, [recordingKeybind, stopAllKeybind, editingSound])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  // Check for updates
  const checkForUpdates = async () => {
    let version = '1.0.0'
    try {
      version = await invoke<string>('get_current_version')
      setCurrentVersion(version)
      addLog(`[Update] Current version: v${version}`, 'debug')
    } catch (error) {
      addLog(`[Update] Failed to get version: ${error}`, 'error')
    }

    try {
      addLog('[Update] Checking for updates...', 'debug')
      const updateInfo = await invoke<{
        available: boolean
        version?: string
        notes?: string
      }>('check_for_updates')

      if (updateInfo.available && updateInfo.version) {
        setUpdateStatus('update-available')
        setLatestVersion(updateInfo.version)
        addLog(`[Update] New version available: v${updateInfo.version}`, 'warn')
        if (updateInfo.notes) {
          addLog(`[Update] Release notes: ${updateInfo.notes.split('\n')[0]}`, 'debug')
        }
      } else {
        setUpdateStatus('up-to-date')
        addLog(`[Update] MotoBoard v${version} is up to date`, 'success')
      }
    } catch (error) {
      // If update check fails, show the actual error for debugging
      setUpdateStatus('up-to-date')
      addLog(`[Update] Check failed: ${error}`, 'warn')
      addLog(`[Update] Running MotoBoard v${version}`, 'info')
    }
  }

  // Install update
  const installUpdate = async () => {
    try {
      setIsUpdating(true)
      addLog('[Update] Downloading update...', 'info')
      await invoke('install_update')
      addLog('[Update] Download complete, restarting...', 'success')
      // App will restart automatically after install
    } catch (error) {
      addLog(`[Update] Failed to install update: ${error}`, 'error')
      setIsUpdating(false)
    }
  }

  // Load devices, sounds, and settings on mount
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const init = async () => {
      addLog('═══════════════════════════════════════', 'info')
      addLog('MotoBoard Starting...', 'success')
      addLog('═══════════════════════════════════════', 'info')

      // Load settings first
      addLog('[Settings] Loading user preferences...', 'debug')
      const { hasSavedPrimaryDevice } = await loadSettings()

      // Load devices
      await loadDevices(!hasSavedPrimaryDevice)

      // Load sounds
      await loadSounds()

      // Check for updates
      addLog('[Update] Checking for updates...', 'debug')
      await checkForUpdates()

      addLog('═══════════════════════════════════════', 'info')
      addLog('MotoBoard Ready', 'success')
      addLog('═══════════════════════════════════════', 'info')
    }
    init()
  }, [])

  const loadSettings = async (): Promise<{ hasSavedPrimaryDevice: boolean }> => {
    try {
      const settings = await invoke<{
        primaryDevice?: string
        monitorDevice?: string
        masterVolume?: number
        stopAllKeybind?: string
        compactMode?: boolean
        theme?: string
        minimizeToTray?: boolean
        overlapMode?: boolean
        crossfadeDuration?: number
      }>('get_settings')

      if (settings.primaryDevice) {
        setPrimaryDevice(settings.primaryDevice)
        addLog(`[Settings] Primary device: ${settings.primaryDevice}`, 'debug')
      }
      if (settings.monitorDevice) {
        setMonitorDevice(settings.monitorDevice)
        addLog(`[Settings] Monitor device: ${settings.monitorDevice}`, 'debug')
      }
      if (settings.masterVolume !== undefined) {
        setMasterVolume(Math.round(settings.masterVolume * 100))
        addLog(`[Settings] Master volume: ${Math.round(settings.masterVolume * 100)}%`, 'debug')
      }
      if (settings.stopAllKeybind) {
        setStopAllKeybind(settings.stopAllKeybind)
        addLog(`[Settings] Stop All keybind: ${settings.stopAllKeybind}`, 'debug')
      }
      if (settings.compactMode !== undefined) {
        setCompactMode(settings.compactMode)
        addLog(`[Settings] Compact mode: ${settings.compactMode ? 'enabled' : 'disabled'}`, 'debug')
      }
      if (settings.theme) {
        setTheme(settings.theme)
        addLog(`[Settings] Theme: ${settings.theme}`, 'debug')
      }
      if (settings.minimizeToTray !== undefined) {
        setMinimizeToTray(settings.minimizeToTray)
        addLog(`[Settings] Minimize to tray: ${settings.minimizeToTray ? 'enabled' : 'disabled'}`, 'debug')
      }
      if (settings.overlapMode !== undefined) {
        setOverlapMode(settings.overlapMode)
        addLog(`[Settings] Overlap mode: ${settings.overlapMode ? 'enabled' : 'disabled'}`, 'debug')
      }
      if (settings.crossfadeDuration !== undefined) {
        setCrossfadeDuration(settings.crossfadeDuration)
        addLog(`[Settings] Crossfade duration: ${settings.crossfadeDuration}ms`, 'debug')
      }

      addLog('[Settings] User preferences loaded', 'success')
      return { hasSavedPrimaryDevice: !!settings.primaryDevice }
    } catch (error) {
      addLog(`[Settings] Failed to load: ${error}`, 'error')
      return { hasSavedPrimaryDevice: false }
    }
  }

  const loadDevices = async (autoSelectIfNoSaved: boolean = true) => {
    try {
      addLog('[Audio] Scanning for audio devices...', 'debug')
      const deviceList = await invoke<AudioDevice[]>('get_audio_devices')
      setDevices(deviceList)
      addLog(`[Audio] Found ${deviceList.length} output devices`, 'success')

      // Log each device
      deviceList.forEach((device, index) => {
        addLog(`[Audio]   ${index + 1}. ${device.name}`, 'debug')
      })

      // Only auto-select VB-Cable if no device was saved
      if (autoSelectIfNoSaved) {
        const vbCable = deviceList.find(d => d.name.toLowerCase().includes('cable input'))
        if (vbCable) {
          setPrimaryDevice(vbCable.name)
          await invoke('set_primary_device', { deviceName: vbCable.name })
          addLog(`[Audio] Auto-selected: ${vbCable.name}`, 'success')
        } else {
          addLog('[Audio] VB-Cable not found - please select output device', 'warn')
        }
      }
    } catch (error) {
      addLog(`[Audio] Failed to load devices: ${error}`, 'error')
    }
  }

  const loadSounds = async () => {
    try {
      addLog('[Sounds] Loading sound library...', 'debug')
      const soundList = await invoke<Sound[]>('get_sounds')
      setSounds(soundList)
      if (soundList.length > 0) {
        addLog(`[Sounds] Loaded ${soundList.length} sounds`, 'success')
        // Log sounds with keybinds
        const withKeybinds = soundList.filter(s => s.keybind)
        if (withKeybinds.length > 0) {
          addLog(`[Sounds] ${withKeybinds.length} sounds have keybinds assigned`, 'debug')
        }
      } else {
        addLog('[Sounds] No sounds loaded - click "Add Sound" to get started', 'info')
      }
    } catch (error) {
      addLog(`[Sounds] Failed to load: ${error}`, 'error')
    }
  }

  const playSound = async (soundId: string) => {
    const sound = sounds.find(s => s.id === soundId)
    try {
      // If overlap mode is disabled, stop all sounds first
      if (!overlapMode) {
        addLog('[Playback] Stopping previous sounds (overlap disabled)', 'debug')
        await invoke('stop_all')
      }

      setPlayingSound(soundId)
      addLog(`[Playback] Playing: ${sound?.name || soundId}`, 'info')
      await invoke('play_sound', { soundId })
      setStatus(`Playing: ${sound?.name}`)

      setTimeout(() => {
        setPlayingSound(null)
        setStatus('Ready')
      }, 3000)
    } catch (error) {
      addLog(`✗ Failed to play ${sound?.name}: ${error}`, 'error')
      setPlayingSound(null)
    }
  }

  const stopAllSounds = async () => {
    try {
      addLog('[Playback] Stop All triggered', 'info')
      await invoke('stop_all')
      setPlayingSound(null)
      setIsQueuePlaying(false)
      setSoundQueue([])
      setStatus('Stopped all sounds')
      addLog('[Playback] All sounds stopped', 'success')
    } catch (error) {
      addLog(`[Playback] Failed to stop sounds: ${error}`, 'error')
    }
  }

  const addToQueue = async (soundId: string) => {
    try {
      const sound = sounds.find(s => s.id === soundId)
      const queue = await invoke<string[]>('add_to_queue', { soundId })
      setSoundQueue(queue)
      addLog(`[Queue] Added "${sound?.name}" to queue (${queue.length} in queue)`, 'info')
      setStatus(`Added to queue: ${sound?.name}`)
    } catch (error) {
      addLog(`[Queue] Failed to add to queue: ${error}`, 'error')
    }
  }

  const clearQueue = async () => {
    try {
      await invoke('clear_queue')
      setSoundQueue([])
      setIsQueuePlaying(false)
      addLog('[Queue] Queue cleared', 'info')
      setStatus('Queue cleared')
    } catch (error) {
      addLog(`[Queue] Failed to clear queue: ${error}`, 'error')
    }
  }

  const playQueue = async () => {
    if (soundQueue.length === 0) {
      addLog('[Queue] Queue is empty', 'warn')
      return
    }
    try {
      setIsQueuePlaying(true)
      addLog(`[Queue] Playing queue (${soundQueue.length} sounds)`, 'info')
      setStatus('Playing queue...')
      await invoke('play_queue')
      // Poll for queue completion
      const checkQueue = setInterval(async () => {
        const playing = await invoke<boolean>('is_queue_playing')
        if (!playing) {
          setIsQueuePlaying(false)
          setSoundQueue([])
          setStatus('Ready')
          addLog('[Queue] Queue finished', 'success')
          clearInterval(checkQueue)
        }
      }, 500)
    } catch (error) {
      setIsQueuePlaying(false)
      addLog(`[Queue] Failed to play queue: ${error}`, 'error')
    }
  }

  const addSound = async () => {
    try {
      addLog('[Sounds] Opening file dialog...', 'debug')
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'ogg', 'flac']
        }]
      })

      if (selected) {
        const files = Array.isArray(selected) ? selected : [selected]
        addLog(`[Sounds] ${files.length} file(s) selected`, 'info')
        for (const filePath of files) {
          const fileName = filePath.split(/[/\\]/).pop() || filePath
          addLog(`[Sounds] Importing: ${fileName}`, 'debug')
          const sound = await invoke<Sound>('add_sound_from_path', { filePath })
          addLog(`[Sounds] Added: ${sound.name}`, 'success')
        }
        loadSounds()
      } else {
        addLog('[Sounds] File selection cancelled', 'debug')
      }
    } catch (error) {
      addLog(`[Sounds] Failed to add sound: ${error}`, 'error')
    }
  }

  const removeSound = async (soundId: string) => {
    const sound = sounds.find(s => s.id === soundId)
    try {
      addLog(`[Sounds] Removing: ${sound?.name || soundId}`, 'debug')
      await invoke('remove_sound', { soundId })
      addLog(`[Sounds] Removed: ${sound?.name || soundId}`, 'success')
      setEditingSound(null)
      loadSounds()
    } catch (error) {
      addLog(`[Sounds] Failed to remove: ${error}`, 'error')
    }
  }

  const updateSoundKeybind = async (soundId: string, keybind: string | null) => {
    const sound = sounds.find(s => s.id === soundId)
    try {
      await invoke('update_sound_keybind', { soundId, keybind })
      if (keybind) {
        addLog(`[Keybind] Set ${sound?.name || soundId} → ${keybind}`, 'success')
      } else {
        addLog(`[Keybind] Cleared keybind for ${sound?.name || soundId}`, 'info')
      }
      loadSounds()
    } catch (error) {
      addLog(`[Keybind] Failed to update: ${error}`, 'error')
    }
  }

  const saveEditingSound = async () => {
    if (!editingSound) return
    try {
      addLog(`[Sounds] Saving settings for: ${editingSound.name}`, 'debug')
      await updateSoundKeybind(editingSound.id, editingSound.keybind)

      // Save volume, loop mode, and audio effects
      await invoke('update_sound_settings', {
        soundId: editingSound.id,
        volume: editingSound.volume,
        loopMode: editingSound.loopMode || false,
        playbackSpeed: editingSound.playbackSpeed || 1.0,
        echoDelay: editingSound.echoDelay || 0,
        echoVolume: editingSound.echoVolume || 0,
        reverbDecay: editingSound.reverbDecay || 0,
        bassBoost: editingSound.bassBoost || 0,
        fakeBassBoost: editingSound.fakeBassBoost || 0
      })

      // Save trim settings
      if (editingSound.startTime || editingSound.endTime) {
        await invoke('update_sound_trim', {
          soundId: editingSound.id,
          startTime: editingSound.startTime || null,
          endTime: editingSound.endTime || null
        })
        addLog(`[Sounds] Trim set: ${(editingSound.startTime || 0).toFixed(1)}s - ${(editingSound.endTime || audioDuration).toFixed(1)}s`, 'debug')
      } else {
        await invoke('update_sound_trim', {
          soundId: editingSound.id,
          startTime: null,
          endTime: null
        })
      }
      addLog(`[Sounds] Settings saved for: ${editingSound.name}`, 'success')
      loadSounds()
    } catch (error) {
      addLog(`[Sounds] Failed to save settings: ${error}`, 'error')
    }
    setEditingSound(null)
  }

  // Load and process audio for waveform visualization
  const loadWaveform = async (filePath: string) => {
    try {
      addLog('[Audio] Generating waveform...', 'debug')
      const audioData = await readBinaryFile(filePath)
      const audioContext = new AudioContext()
      const audioBuffer = await audioContext.decodeAudioData(audioData.buffer as ArrayBuffer)

      setAudioDuration(audioBuffer.duration)
      addLog(`[Audio] Duration: ${audioBuffer.duration.toFixed(2)}s, Sample rate: ${audioBuffer.sampleRate}Hz`, 'debug')

      // Get the audio channel data
      const channelData = audioBuffer.getChannelData(0)
      const samples = 200 // Number of bars in waveform
      const blockSize = Math.floor(channelData.length / samples)
      const waveform: number[] = []

      for (let i = 0; i < samples; i++) {
        let sum = 0
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(channelData[i * blockSize + j])
        }
        waveform.push(sum / blockSize)
      }

      // Normalize waveform
      const max = Math.max(...waveform)
      const normalized = waveform.map(v => v / max)
      setWaveformData(normalized)

      audioContext.close()
    } catch (error) {
      addLog(`[Audio] Failed to load waveform: ${error}`, 'error')
      setWaveformData([])
    }
  }

  // Draw waveform on canvas
  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current
    if (!canvas || waveformData.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const barWidth = width / waveformData.length
    const barGap = 1

    // Clear canvas
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, width, height)

    // Draw waveform bars
    waveformData.forEach((value, index) => {
      const barHeight = value * (height - 10)
      const x = index * barWidth
      const y = (height - barHeight) / 2

      // Calculate if this bar is within the trim range
      const startPercent = (editingSound?.startTime || 0) / audioDuration
      const endPercent = (editingSound?.endTime || audioDuration) / audioDuration
      const currentPercent = index / waveformData.length

      if (currentPercent >= startPercent && currentPercent <= endPercent) {
        ctx.fillStyle = '#00ff41'
      } else {
        ctx.fillStyle = '#333'
      }

      ctx.fillRect(x + barGap / 2, y, barWidth - barGap, barHeight)
    })
  }, [waveformData, editingSound, audioDuration])

  // Load waveform when editing a sound
  useEffect(() => {
    if (editingSound) {
      loadWaveform(editingSound.filePath)
    } else {
      setWaveformData([])
      setAudioDuration(0)
    }
  }, [editingSound?.id])

  // Redraw waveform when data changes
  useEffect(() => {
    drawWaveform()
  }, [drawWaveform])

  // Preview trim audio
  const previewTrim = async () => {
    if (!editingSound || !audioDuration) return

    // Stop any existing preview
    stopPreview()

    try {
      const audioData = await readBinaryFile(editingSound.filePath)
      const blob = new Blob([audioData.buffer as ArrayBuffer], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)

      const audio = new Audio(url)
      previewAudioRef.current = audio

      const startTime = editingSound.startTime || 0
      const endTime = editingSound.endTime || audioDuration

      audio.currentTime = startTime
      setIsPreviewPlaying(true)

      audio.addEventListener('timeupdate', () => {
        if (audio.currentTime >= endTime) {
          audio.pause()
          setIsPreviewPlaying(false)
        }
      })

      audio.addEventListener('ended', () => {
        setIsPreviewPlaying(false)
        URL.revokeObjectURL(url)
      })

      await audio.play()
      addLog(`[Preview] Playing: ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s`, 'info')
    } catch (error) {
      addLog(`[Preview] Failed to play: ${error}`, 'error')
      setIsPreviewPlaying(false)
    }
  }

  const stopPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current = null
    }
    setIsPreviewPlaying(false)
  }

  // Stop preview when closing modal
  useEffect(() => {
    if (!editingSound) {
      stopPreview()
    }
  }, [editingSound])

  const handlePrimaryDeviceChange = async (deviceName: string) => {
    addLog(`[Audio] Changing primary output...`, 'debug')
    setPrimaryDevice(deviceName)
    try {
      await invoke('set_primary_device', { deviceName })
      setStatus(`Primary device: ${deviceName}`)
      addLog(`[Audio] Primary output: ${deviceName}`, 'success')
    } catch (error) {
      addLog(`[Audio] Failed to set primary device: ${error}`, 'error')
    }
  }

  const handleMonitorDeviceChange = async (deviceName: string) => {
    addLog(`[Audio] Changing monitor output...`, 'debug')
    setMonitorDevice(deviceName)
    try {
      await invoke('set_monitor_device', { deviceName })
      addLog(`[Audio] Monitor output: ${deviceName || 'None (disabled)'}`, 'success')
    } catch (error) {
      addLog(`[Audio] Failed to set monitor device: ${error}`, 'error')
    }
  }

  const handleVolumeChange = async (volume: number) => {
    setMasterVolume(volume)
    try {
      await invoke('set_master_volume', { volume: volume / 100 })
      // Only log on significant changes to avoid spam
    } catch (error) {
      addLog(`[Audio] Failed to set volume: ${error}`, 'error')
    }
  }

  const handleCompactModeChange = async (enabled: boolean) => {
    setCompactMode(enabled)
    try {
      await invoke('set_compact_mode', { enabled })
      addLog(`[UI] Compact mode: ${enabled ? 'enabled' : 'disabled'}`, 'success')
    } catch (error) {
      addLog(`[UI] Failed to set compact mode: ${error}`, 'error')
    }
  }

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme)
    try {
      await invoke('set_theme', { theme: newTheme })
      addLog(`[UI] Theme changed: ${newTheme}`, 'success')
    } catch (error) {
      addLog(`[UI] Failed to set theme: ${error}`, 'error')
    }
  }

  const handleMinimizeToTrayChange = async (enabled: boolean) => {
    setMinimizeToTray(enabled)
    try {
      await invoke('set_minimize_to_tray', { enabled })
      addLog(`[UI] Minimize to tray: ${enabled ? 'enabled' : 'disabled'}`, 'success')
    } catch (error) {
      addLog(`[UI] Failed to set minimize to tray: ${error}`, 'error')
    }
  }

  const handleOverlapModeChange = async (enabled: boolean) => {
    setOverlapMode(enabled)
    try {
      await invoke('set_overlap_mode', { enabled })
      addLog(`[Playback] Overlap mode: ${enabled ? 'enabled' : 'disabled'}`, 'success')
    } catch (error) {
      addLog(`[Playback] Failed to set overlap mode: ${error}`, 'error')
    }
  }

  const handleCrossfadeDurationChange = async (duration: number) => {
    setCrossfadeDuration(duration)
    try {
      await invoke('set_crossfade_duration', { duration })
      addLog(`[Playback] Crossfade duration: ${duration}ms`, 'success')
    } catch (error) {
      addLog(`[Playback] Failed to set crossfade duration: ${error}`, 'error')
    }
  }

  // Apply theme and compact mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-compact', String(compactMode))
  }, [theme, compactMode])

  // Drag and drop using mouse events (more reliable than HTML5 drag API in WebView)
  const handleMouseDown = (e: React.MouseEvent, soundId: string) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.sound-edit-btn')) return
    e.preventDefault()
    setDraggedSound(soundId)
  }

  const handleMouseEnter = (soundId: string) => {
    if (draggedSound && draggedSound !== soundId) {
      setDragOverSound(soundId)
    }
  }

  const handleMouseLeave = () => {
    if (draggedSound) {
      setDragOverSound(null)
    }
  }

  const handleMouseUp = async (e: React.MouseEvent, soundId: string) => {
    if (!draggedSound) return
    e.stopPropagation()

    if (draggedSound === soundId) {
      setDraggedSound(null)
      setDragOverSound(null)
      return
    }

    // Reorder sounds
    const draggedIndex = sounds.findIndex(s => s.id === draggedSound)
    const targetIndex = sounds.findIndex(s => s.id === soundId)

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedSound(null)
      setDragOverSound(null)
      return
    }

    const newSounds = [...sounds]
    const [removed] = newSounds.splice(draggedIndex, 1)
    newSounds.splice(targetIndex, 0, removed)

    setSounds(newSounds)

    try {
      const soundIds = newSounds.map(s => s.id)
      await invoke('update_sound_order', { soundIds })
      addLog('[Sounds] Sound order updated', 'success')
    } catch (error) {
      addLog(`[Sounds] Failed to update order: ${error}`, 'error')
      loadSounds()
    }

    setDraggedSound(null)
    setDragOverSound(null)
  }

  // Cancel drag if mouse up outside any card
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (draggedSound) {
        setDraggedSound(null)
        setDragOverSound(null)
      }
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [draggedSound])

  return (
    <>
      {/* Header */}
      <header className="header">
        <div className="logo-section">
          <div className="logo">MOTOBOARD</div>
          {/* Version Status */}
          <div className={`version-status ${updateStatus}`}>
            {updateStatus === 'checking' && (
              <span className="version-text">Checking...</span>
            )}
            {updateStatus === 'up-to-date' && (
              <span className="version-text">v{currentVersion} ✓</span>
            )}
            {updateStatus === 'update-available' && (
              <>
                <span className="version-text">v{latestVersion} available</span>
                <button
                  className="btn-update"
                  onClick={installUpdate}
                  disabled={isUpdating}
                >
                  {isUpdating ? 'Updating...' : 'Update Now'}
                </button>
              </>
            )}
            {updateStatus === 'error' && (
              <span className="version-text">v{currentVersion}</span>
            )}
          </div>
        </div>
        <div className="header-controls">
          <button className="btn btn-danger" onClick={stopAllSounds}>
            Stop All {stopAllKeybind && <span className="btn-keybind">[{stopAllKeybind}]</span>}
          </button>
          {soundQueue.length > 0 && (
            <div className="queue-controls">
              <button
                className={`btn btn-queue ${isQueuePlaying ? 'playing' : ''}`}
                onClick={playQueue}
                disabled={isQueuePlaying}
              >
                {isQueuePlaying ? 'Playing...' : `Play Queue (${soundQueue.length})`}
              </button>
              <button className="btn btn-secondary" onClick={clearQueue} disabled={isQueuePlaying}>
                Clear
              </button>
            </div>
          )}
          <button className="btn btn-primary" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Sound Grid */}
        <div className="sound-grid">
          {sounds.map((sound) => (
            <div
              key={sound.id}
              className={`sound-card ${draggedSound === sound.id ? 'dragging' : ''} ${dragOverSound === sound.id ? 'drag-over' : ''}`}
              onMouseDown={(e) => handleMouseDown(e, sound.id)}
              onMouseEnter={() => handleMouseEnter(sound.id)}
              onMouseLeave={handleMouseLeave}
              onMouseUp={(e) => handleMouseUp(e, sound.id)}
            >
              <button
                className={`sound-btn ${playingSound === sound.id ? 'playing' : ''}`}
                onClick={() => playSound(sound.id)}
              >
                <span className="sound-btn-name">{sound.name}</span>
                {sound.keybind && (
                  <span className="sound-btn-keybind">{sound.keybind}</span>
                )}
              </button>
              <button
                className="sound-queue-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  addToQueue(sound.id)
                }}
                title="Add to queue"
              >
                +
              </button>
              <button
                className="sound-edit-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingSound(sound)
                }}
                title="Edit sound"
              >
                ⚙
              </button>
            </div>
          ))}

          {/* Add Sound Button */}
          <button className="add-sound-btn" onClick={addSound}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="6" y="6" width="12" height="12" rx="2" strokeWidth="1.5" />
              <line x1="12" y1="9" x2="12" y2="15" />
              <line x1="9" y1="12" x2="15" y2="12" />
            </svg>
            <span>Add Sound</span>
          </button>
        </div>

        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-title">Output Device (VB-Cable)</h3>
            <select
              className="device-select"
              value={primaryDevice}
              onChange={(e) => handlePrimaryDeviceChange(e.target.value)}
            >
              <option value="">Select device...</option>
              {devices.map((device) => (
                <option key={device.id} value={device.name}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sidebar-section">
            <h3 className="sidebar-title">Monitor (Your Headset)</h3>
            <select
              className="device-select"
              value={monitorDevice}
              onChange={(e) => handleMonitorDeviceChange(e.target.value)}
            >
              <option value="">None</option>
              {devices.map((device) => (
                <option key={device.id} value={device.name}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sidebar-section">
            <h3 className="sidebar-title">Master Volume</h3>
            <div className="volume-container">
              <input
                type="range"
                className="volume-slider"
                min="0"
                max="100"
                value={masterVolume}
                onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
              />
              <span className="volume-value">{masterVolume}%</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Console Panel */}
      {showConsole && (
        <div className={`console-panel ${consoleCollapsed ? 'collapsed' : ''}`}>
          <div className="console-header">
            <span className="console-title">Console</span>
            <button
              className="console-toggle"
              onClick={() => setConsoleCollapsed(!consoleCollapsed)}
            >
              {consoleCollapsed ? '▲' : '▼'}
            </button>
          </div>
          <div className="console-content" ref={consoleRef}>
            {logs.map((log, i) => (
              <div key={i} className={`console-line ${log.type}`}>
                <span className="timestamp">[{log.timestamp}]</span>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Bar */}
      <footer className="status-bar">
        <span>{status}</span>
        <span className="status-device">
          {primaryDevice || 'No device selected'}
        </span>
      </footer>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
              <button className="modal-close" onClick={() => setShowSettings(false)}>×</button>
            </div>
            <div className="modal-content">
              {/* Hotkeys */}
              <div className="settings-section">
                <h3>Global Hotkeys</h3>
                <div className="settings-item">
                  <label>Stop All Sounds</label>
                  <div className="keybind-input-row">
                    <button
                      className={`keybind-input ${recordingKeybind === 'stopAll' ? 'recording' : ''}`}
                      onClick={() => setRecordingKeybind('stopAll')}
                    >
                      {recordingKeybind === 'stopAll'
                        ? 'Press any key...'
                        : stopAllKeybind || 'Click to set keybind'}
                    </button>
                    {stopAllKeybind && (
                      <button
                        className="keybind-clear"
                        onClick={async () => {
                          await unregisterStopAllKeybind(stopAllKeybind)
                          setStopAllKeybind('')
                          await invoke('set_stop_all_keybind', { keybind: null })
                          addLog('[Keybind] Stop All keybind cleared', 'info')
                        }}
                      >
                        X
                      </button>
                    )}
                  </div>
                  <p className="settings-hint">Press this key combo anywhere to stop all sounds</p>
                </div>
              </div>

              {/* Playback */}
              <div className="settings-section">
                <h3>Playback</h3>
                <div className="settings-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={overlapMode}
                      onChange={(e) => handleOverlapModeChange(e.target.checked)}
                    />
                    <span>Allow sound overlap</span>
                  </label>
                  <p className="settings-hint">Play multiple sounds at once</p>
                </div>
                <div className="settings-item">
                  <label>Queue Crossfade: {crossfadeDuration}ms</label>
                  <input
                    type="range"
                    min="0"
                    max="2000"
                    step="100"
                    value={crossfadeDuration}
                    onChange={(e) => handleCrossfadeDurationChange(parseInt(e.target.value))}
                    className="settings-slider"
                  />
                  <p className="settings-hint">Fade between sounds in queue mode (0 = off)</p>
                </div>
              </div>

              {/* Audio */}
              <div className="settings-section">
                <h3>Audio</h3>
                <div className="settings-item">
                  <label>Default Volume for New Sounds</label>
                  <div className="volume-container">
                    <input
                      type="range"
                      className="volume-slider"
                      min="0"
                      max="100"
                      value={defaultVolume}
                      onChange={(e) => setDefaultVolume(parseInt(e.target.value))}
                    />
                    <span className="volume-value">{defaultVolume}%</span>
                  </div>
                </div>
                <div className="settings-item">
                  <label>Fade In Duration (ms)</label>
                  <div className="volume-container">
                    <input
                      type="range"
                      className="volume-slider"
                      min="0"
                      max="500"
                      step="10"
                      value={fadeInDuration}
                      onChange={(e) => setFadeInDuration(parseInt(e.target.value))}
                    />
                    <span className="volume-value">{fadeInDuration}</span>
                  </div>
                </div>
                <div className="settings-item">
                  <label>Fade Out Duration (ms)</label>
                  <div className="volume-container">
                    <input
                      type="range"
                      className="volume-slider"
                      min="0"
                      max="500"
                      step="10"
                      value={fadeOutDuration}
                      onChange={(e) => setFadeOutDuration(parseInt(e.target.value))}
                    />
                    <span className="volume-value">{fadeOutDuration}</span>
                  </div>
                </div>
              </div>

              {/* Interface */}
              <div className="settings-section">
                <h3>Interface</h3>
                <div className="settings-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={showConsole}
                      onChange={(e) => setShowConsole(e.target.checked)}
                    />
                    <span>Show console panel</span>
                  </label>
                  <p className="settings-hint">Display the log console at the bottom</p>
                </div>
                <div className="settings-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={compactMode}
                      onChange={(e) => handleCompactModeChange(e.target.checked)}
                    />
                    <span>Compact mode</span>
                  </label>
                  <p className="settings-hint">Smaller buttons to fit more sounds on screen</p>
                </div>
                <div className="settings-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={minimizeToTray}
                      onChange={(e) => handleMinimizeToTrayChange(e.target.checked)}
                    />
                    <span>Minimize to tray</span>
                  </label>
                  <p className="settings-hint">Keep running in system tray when closed</p>
                </div>
              </div>

              {/* Theme */}
              <div className="settings-section">
                <h3>Theme</h3>
                <div className="settings-item">
                  <label>Color Scheme</label>
                  <div className="theme-select">
                    {['green', 'purple', 'blue', 'red', 'cyan', 'orange', 'pink'].map((t) => (
                      <button
                        key={t}
                        className={`theme-option ${theme === t ? 'active' : ''}`}
                        data-theme={t}
                        onClick={() => handleThemeChange(t)}
                        title={t.charAt(0).toUpperCase() + t.slice(1)}
                      >
                        <div className="theme-color" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sound Edit Modal */}
      {editingSound && (
        <div className="modal-overlay" onClick={() => setEditingSound(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Sound</h2>
              <button className="modal-close" onClick={() => setEditingSound(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="settings-section">
                <h3>{editingSound.name}</h3>
                <p className="file-path">{editingSound.filePath}</p>
              </div>

              <div className="settings-section">
                <h3>Keybind</h3>
                <div className="settings-item">
                  <div className="keybind-input-row">
                    <button
                      className={`keybind-input ${recordingKeybind === 'sound' ? 'recording' : ''}`}
                      onClick={() => setRecordingKeybind('sound')}
                    >
                      {recordingKeybind === 'sound'
                        ? 'Press any key...'
                        : editingSound.keybind || 'Click to set keybind'}
                    </button>
                    {editingSound.keybind && (
                      <button
                        className="keybind-clear"
                        onClick={async () => {
                          await unregisterSoundKeybind(editingSound.keybind!)
                          setEditingSound({ ...editingSound, keybind: null })
                          addLog(`[Keybind] Cleared keybind for: ${editingSound.name}`, 'info')
                        }}
                      >
                        X
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>Volume</h3>
                <div className="settings-item">
                  <div className="volume-container">
                    <input
                      type="range"
                      className="volume-slider"
                      min="0"
                      max="200"
                      value={Math.round(editingSound.volume * 100)}
                      onChange={(e) => setEditingSound({
                        ...editingSound,
                        volume: parseInt(e.target.value) / 100
                      })}
                    />
                    <span className="volume-value">{Math.round(editingSound.volume * 100)}%</span>
                  </div>
                  <p className="settings-hint">Individual volume (0-200%, relative to master)</p>
                </div>
              </div>

              <div className="settings-section">
                <h3>Playback</h3>
                <div className="settings-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingSound.loopMode || false}
                      onChange={(e) => setEditingSound({
                        ...editingSound,
                        loopMode: e.target.checked
                      })}
                    />
                    <span>Loop Mode</span>
                  </label>
                  <p className="settings-hint">Repeat sound until stopped</p>
                </div>
              </div>

              <div className="settings-section">
                <h3>Audio Effects</h3>

                {/* Speed Control */}
                <div className="effect-group">
                  <div className="effect-group-header">Speed</div>
                  <div className="settings-item">
                    <label>Playback Speed: {((editingSound.playbackSpeed || 1) * 100).toFixed(0)}%</label>
                    <div className="volume-container">
                      <input
                        type="range"
                        className="volume-slider"
                        min="25"
                        max="200"
                        step="5"
                        value={Math.round((editingSound.playbackSpeed || 1) * 100)}
                        onChange={(e) => setEditingSound({
                          ...editingSound,
                          playbackSpeed: parseInt(e.target.value) / 100
                        })}
                      />
                      <button
                        className="reset-btn"
                        onClick={() => setEditingSound({ ...editingSound, playbackSpeed: 1.0 })}
                        title="Reset to 100%"
                      >
                        ↺
                      </button>
                    </div>
                    <p className="settings-hint">Slower = lower pitch, Faster = higher pitch</p>
                  </div>
                </div>

                {/* Echo & Reverb */}
                <div className="effect-group">
                  <div className="effect-group-header">Echo & Reverb</div>
                  <div className="settings-item">
                    <label>Echo Delay: {((editingSound.echoDelay || 0) * 1000).toFixed(0)}ms</label>
                    <div className="volume-container">
                      <input
                        type="range"
                        className="volume-slider"
                        min="0"
                        max="1000"
                        step="50"
                        value={Math.round((editingSound.echoDelay || 0) * 1000)}
                        onChange={(e) => setEditingSound({
                          ...editingSound,
                          echoDelay: parseInt(e.target.value) / 1000
                        })}
                      />
                      <button
                        className="reset-btn"
                        onClick={() => setEditingSound({ ...editingSound, echoDelay: 0, echoVolume: 0, reverbDecay: 0 })}
                        title="Reset Echo"
                      >
                        ↺
                      </button>
                    </div>
                    <p className="settings-hint">Time between original and echo (0 = off)</p>
                  </div>
                  <div className="settings-item">
                    <label>Echo Volume: {Math.round((editingSound.echoVolume || 0) * 100)}%</label>
                    <div className="volume-container">
                      <input
                        type="range"
                        className="volume-slider"
                        min="0"
                        max="100"
                        step="5"
                        value={Math.round((editingSound.echoVolume || 0) * 100)}
                        onChange={(e) => setEditingSound({
                          ...editingSound,
                          echoVolume: parseInt(e.target.value) / 100
                        })}
                      />
                    </div>
                    <p className="settings-hint">How loud the echo is</p>
                  </div>
                  <div className="settings-item">
                    <label>Reverb: {Math.round((editingSound.reverbDecay || 0) * 100)}%</label>
                    <div className="volume-container">
                      <input
                        type="range"
                        className="volume-slider"
                        min="0"
                        max="90"
                        step="10"
                        value={Math.round((editingSound.reverbDecay || 0) * 100)}
                        onChange={(e) => setEditingSound({
                          ...editingSound,
                          reverbDecay: parseInt(e.target.value) / 100
                        })}
                      />
                    </div>
                    <p className="settings-hint">Multiple fading echoes for room/hall effect</p>
                  </div>
                </div>

                {/* Bass Effects */}
                <div className="effect-group">
                  <div className="effect-group-header">Bass</div>
                  <div className="settings-item">
                    <label>Bass Boost: {Math.round((editingSound.bassBoost || 0) * 100)}%</label>
                    <div className="volume-container">
                      <input
                        type="range"
                        className="volume-slider"
                        min="0"
                        max="300"
                        step="25"
                        value={Math.round((editingSound.bassBoost || 0) * 100)}
                        onChange={(e) => setEditingSound({
                          ...editingSound,
                          bassBoost: parseInt(e.target.value) / 100
                        })}
                      />
                      <button
                        className="reset-btn"
                        onClick={() => setEditingSound({ ...editingSound, bassBoost: 0, fakeBassBoost: 0 })}
                        title="Reset Bass"
                      >
                        ↺
                      </button>
                    </div>
                    <p className="settings-hint">Adds low frequency layer on top of audio</p>
                  </div>
                  <div className="settings-item">
                    <label>Extreme Bass: {Math.round((editingSound.fakeBassBoost || 0) * 100)}%</label>
                    <div className="volume-container">
                      <input
                        type="range"
                        className="volume-slider"
                        min="0"
                        max="1000"
                        step="50"
                        value={Math.round((editingSound.fakeBassBoost || 0) * 100)}
                        onChange={(e) => setEditingSound({
                          ...editingSound,
                          fakeBassBoost: parseInt(e.target.value) / 100
                        })}
                      />
                    </div>
                    <p className="settings-hint">Replaces audio entirely (disables other effects)</p>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>Trim Audio</h3>
                <div className="trim-controls">
                  <div className="trim-waveform">
                    <canvas
                      ref={waveformCanvasRef}
                      width={440}
                      height={70}
                      className="waveform-canvas"
                    />
                  </div>
                  <div className="trim-duration">
                    Duration: {audioDuration.toFixed(2)}s
                  </div>
                  <div className="trim-slider-section">
                    <div className="trim-slider-row">
                      <label>Start: {(editingSound.startTime || 0).toFixed(1)}s</label>
                      <input
                        type="range"
                        className="volume-slider trim-slider"
                        min="0"
                        max={audioDuration || 1}
                        step="0.5"
                        value={editingSound.startTime || 0}
                        onChange={(e) => {
                          const newStart = parseFloat(e.target.value)
                          const currentEnd = editingSound.endTime || audioDuration
                          setEditingSound({
                            ...editingSound,
                            startTime: Math.min(newStart, currentEnd - 0.5)
                          })
                        }}
                      />
                    </div>
                    <div className="trim-slider-row">
                      <label>End: {(editingSound.endTime || audioDuration).toFixed(1)}s</label>
                      <input
                        type="range"
                        className="volume-slider trim-slider"
                        min="0"
                        max={audioDuration || 1}
                        step="0.5"
                        value={editingSound.endTime || audioDuration}
                        onChange={(e) => {
                          const newEnd = parseFloat(e.target.value)
                          const currentStart = editingSound.startTime || 0
                          setEditingSound({
                            ...editingSound,
                            endTime: Math.max(newEnd, currentStart + 0.5)
                          })
                        }}
                      />
                    </div>
                  </div>
                  <div className="trim-preview-buttons">
                    {!isPreviewPlaying ? (
                      <button className="btn btn-white btn-small" onClick={previewTrim}>
                        Preview Trim
                      </button>
                    ) : (
                      <button className="btn btn-danger btn-small" onClick={stopPreview}>
                        Stop Preview
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="btn btn-primary" onClick={saveEditingSound}>
                  Save Changes
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => removeSound(editingSound.id)}
                >
                  Delete Sound
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
