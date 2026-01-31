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
}

interface AudioDevice {
  id: number
  name: string
}

interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error'
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
  const consoleRef = useRef<HTMLDivElement>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

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
      addLog(`Global keybind registered: ${keybind}`, 'success')
    } catch (error) {
      addLog(`Failed to register keybind: ${error}`, 'error')
    }
  }

  // Unregister a global keybind
  const unregisterSoundKeybind = async (keybind: string) => {
    try {
      await invoke('unregister_sound_keybind', { keybind })
    } catch (error) {
      // Ignore errors when unregistering
    }
  }

  // Register stop all keybind
  const registerStopAllKeybind = async (keybind: string) => {
    try {
      await invoke('register_stop_all_keybind', { keybind })
      addLog(`Stop All keybind registered: ${keybind}`, 'success')
    } catch (error) {
      addLog(`Failed to register stop all keybind: ${error}`, 'error')
    }
  }

  // Unregister stop all keybind
  const unregisterStopAllKeybind = async (keybind: string) => {
    try {
      await invoke('unregister_stop_all_keybind', { keybind })
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
    try {
      const version = await invoke<string>('get_current_version')
      setCurrentVersion(version)

      const updateInfo = await invoke<{
        available: boolean
        version?: string
        notes?: string
      }>('check_for_updates')

      if (updateInfo.available && updateInfo.version) {
        setUpdateStatus('update-available')
        setLatestVersion(updateInfo.version)
        addLog(`Update available: v${updateInfo.version}`, 'info')
      } else {
        setUpdateStatus('up-to-date')
        addLog(`MotoBoard v${version} - Up to date`, 'success')
      }
    } catch (error) {
      // If update check fails (e.g., no internet, no releases yet), just show current version
      setUpdateStatus('up-to-date')
      addLog(`MotoBoard v${currentVersion || '1.0.0'}`, 'info')
    }
  }

  // Install update
  const installUpdate = async () => {
    try {
      setIsUpdating(true)
      addLog('Downloading update...', 'info')
      await invoke('install_update')
      // App will restart automatically after install
    } catch (error) {
      addLog(`Failed to install update: ${error}`, 'error')
      setIsUpdating(false)
    }
  }

  // Load devices, sounds, and settings on mount
  useEffect(() => {
    const init = async () => {
      addLog('MotoBoard initialized', 'success')
      // Load settings first to get saved device preferences
      const { hasSavedPrimaryDevice } = await loadSettings()
      // Then load devices (auto-select only if no saved device)
      await loadDevices(!hasSavedPrimaryDevice)
      loadSounds()
      // Check for updates
      checkForUpdates()
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
      }>('get_settings')

      if (settings.primaryDevice) {
        setPrimaryDevice(settings.primaryDevice)
      }
      if (settings.monitorDevice) {
        setMonitorDevice(settings.monitorDevice)
      }
      if (settings.masterVolume !== undefined) {
        setMasterVolume(Math.round(settings.masterVolume * 100))
      }
      if (settings.stopAllKeybind) {
        setStopAllKeybind(settings.stopAllKeybind)
        addLog(`Loaded Stop All keybind: ${settings.stopAllKeybind}`, 'info')
      }
      if (settings.compactMode !== undefined) {
        setCompactMode(settings.compactMode)
      }
      if (settings.theme) {
        setTheme(settings.theme)
      }
      if (settings.minimizeToTray !== undefined) {
        setMinimizeToTray(settings.minimizeToTray)
      }

      return { hasSavedPrimaryDevice: !!settings.primaryDevice }
    } catch (error) {
      addLog(`Failed to load settings: ${error}`, 'error')
      return { hasSavedPrimaryDevice: false }
    }
  }

  const loadDevices = async (autoSelectIfNoSaved: boolean = true) => {
    try {
      addLog('Loading audio devices...')
      const deviceList = await invoke<AudioDevice[]>('get_audio_devices')
      setDevices(deviceList)
      addLog(`Found ${deviceList.length} audio devices`, 'success')

      // Only auto-select VB-Cable if no device was saved
      if (autoSelectIfNoSaved) {
        const vbCable = deviceList.find(d => d.name.toLowerCase().includes('cable input'))
        if (vbCable) {
          setPrimaryDevice(vbCable.name)
          await invoke('set_primary_device', { deviceName: vbCable.name })
          addLog(`Auto-selected VB-Cable: ${vbCable.name}`, 'success')
        }
      }
    } catch (error) {
      addLog(`Failed to load devices: ${error}`, 'error')
    }
  }

  const loadSounds = async () => {
    try {
      const soundList = await invoke<Sound[]>('get_sounds')
      setSounds(soundList)
      if (soundList.length > 0) {
        addLog(`Loaded ${soundList.length} sounds`, 'success')
      }
    } catch (error) {
      addLog(`Failed to load sounds: ${error}`, 'error')
    }
  }

  const playSound = async (soundId: string) => {
    const sound = sounds.find(s => s.id === soundId)
    try {
      // If overlap mode is disabled, stop all sounds first
      if (!overlapMode) {
        await invoke('stop_all')
      }

      setPlayingSound(soundId)
      addLog(`Playing: ${sound?.name || soundId}`)
      await invoke('play_sound', { soundId })
      setStatus(`Playing: ${sound?.name}`)
      addLog(`✓ Started playback: ${sound?.name}`, 'success')

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
      addLog('Stopping all sounds...')
      await invoke('stop_all')
      setPlayingSound(null)
      setStatus('Stopped all sounds')
      addLog('✓ All sounds stopped', 'success')
    } catch (error) {
      addLog(`✗ Failed to stop sounds: ${error}`, 'error')
    }
  }

  const addSound = async () => {
    try {
      addLog('Opening file dialog...')
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'ogg', 'flac']
        }]
      })

      if (selected) {
        const files = Array.isArray(selected) ? selected : [selected]
        for (const filePath of files) {
          addLog(`Adding: ${filePath}`)
          const sound = await invoke<Sound>('add_sound_from_path', { filePath })
          addLog(`✓ Added sound: ${sound.name}`, 'success')
        }
        loadSounds()
      } else {
        addLog('File selection cancelled')
      }
    } catch (error) {
      addLog(`✗ Failed to add sound: ${error}`, 'error')
    }
  }

  const removeSound = async (soundId: string) => {
    try {
      await invoke('remove_sound', { soundId })
      addLog('✓ Sound removed', 'success')
      setEditingSound(null)
      loadSounds()
    } catch (error) {
      addLog(`✗ Failed to remove sound: ${error}`, 'error')
    }
  }

  const updateSoundKeybind = async (soundId: string, keybind: string | null) => {
    try {
      await invoke('update_sound_keybind', { soundId, keybind })
      addLog(`✓ Keybind updated`, 'success')
      loadSounds()
    } catch (error) {
      addLog(`✗ Failed to update keybind: ${error}`, 'error')
    }
  }

  const saveEditingSound = async () => {
    if (!editingSound) return
    try {
      await updateSoundKeybind(editingSound.id, editingSound.keybind)
      await invoke('update_sound_trim', {
        soundId: editingSound.id,
        startTime: editingSound.startTime || null,
        endTime: editingSound.endTime || null
      })
      addLog(`✓ Sound settings saved`, 'success')
      loadSounds()
    } catch (error) {
      addLog(`✗ Failed to save sound: ${error}`, 'error')
    }
    setEditingSound(null)
  }

  // Load and process audio for waveform visualization
  const loadWaveform = async (filePath: string) => {
    try {
      const audioData = await readBinaryFile(filePath)
      const audioContext = new AudioContext()
      const audioBuffer = await audioContext.decodeAudioData(audioData.buffer as ArrayBuffer)

      setAudioDuration(audioBuffer.duration)

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
      addLog(`Failed to load waveform: ${error}`, 'error')
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
      addLog(`Preview: ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s`, 'info')
    } catch (error) {
      addLog(`Failed to preview: ${error}`, 'error')
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
    setPrimaryDevice(deviceName)
    try {
      await invoke('set_primary_device', { deviceName })
      setStatus(`Primary device: ${deviceName}`)
      addLog(`Primary device set: ${deviceName}`, 'success')
    } catch (error) {
      addLog(`✗ Failed to set primary device: ${error}`, 'error')
    }
  }

  const handleMonitorDeviceChange = async (deviceName: string) => {
    setMonitorDevice(deviceName)
    try {
      await invoke('set_monitor_device', { deviceName })
      addLog(`Monitor device set: ${deviceName || 'None'}`, 'success')
    } catch (error) {
      addLog(`✗ Failed to set monitor device: ${error}`, 'error')
    }
  }

  const handleVolumeChange = async (volume: number) => {
    setMasterVolume(volume)
    try {
      await invoke('set_master_volume', { volume: volume / 100 })
    } catch (error) {
      addLog(`✗ Failed to set volume: ${error}`, 'error')
    }
  }

  const handleCompactModeChange = async (enabled: boolean) => {
    setCompactMode(enabled)
    try {
      await invoke('set_compact_mode', { enabled })
      addLog(`Compact mode ${enabled ? 'enabled' : 'disabled'}`, 'success')
    } catch (error) {
      addLog(`✗ Failed to set compact mode: ${error}`, 'error')
    }
  }

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme)
    try {
      await invoke('set_theme', { theme: newTheme })
      addLog(`Theme changed to ${newTheme}`, 'success')
    } catch (error) {
      addLog(`✗ Failed to set theme: ${error}`, 'error')
    }
  }

  const handleMinimizeToTrayChange = async (enabled: boolean) => {
    setMinimizeToTray(enabled)
    try {
      await invoke('set_minimize_to_tray', { enabled })
      addLog(`Minimize to tray ${enabled ? 'enabled' : 'disabled'}`, 'success')
    } catch (error) {
      addLog(`✗ Failed to set minimize to tray: ${error}`, 'error')
    }
  }

  // Apply theme and compact mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-compact', String(compactMode))
  }, [theme, compactMode])

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, soundId: string) => {
    e.stopPropagation()
    setDraggedSound(soundId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', soundId)

    // Add a slight delay for visual feedback
    setTimeout(() => {
      const card = document.querySelector(`[data-sound-id="${soundId}"]`) as HTMLElement
      if (card) {
        card.classList.add('dragging')
      }
    }, 0)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    e.stopPropagation()
    // Remove dragging class from all cards
    document.querySelectorAll('.sound-card.dragging').forEach(el => {
      el.classList.remove('dragging')
    })
    setDraggedSound(null)
    setDragOverSound(null)
  }

  const handleDragOver = (e: React.DragEvent, soundId: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (draggedSound && soundId !== draggedSound) {
      setDragOverSound(soundId)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation()
    setDragOverSound(null)
  }

  const handleDrop = async (e: React.DragEvent, targetSoundId: string) => {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedSound || draggedSound === targetSoundId) {
      setDraggedSound(null)
      setDragOverSound(null)
      return
    }

    // Reorder sounds
    const draggedIndex = sounds.findIndex(s => s.id === draggedSound)
    const targetIndex = sounds.findIndex(s => s.id === targetSoundId)

    if (draggedIndex === -1 || targetIndex === -1) return

    const newSounds = [...sounds]
    const [removed] = newSounds.splice(draggedIndex, 1)
    newSounds.splice(targetIndex, 0, removed)

    // Update local state immediately
    setSounds(newSounds)

    // Save new order to backend
    try {
      const soundIds = newSounds.map(s => s.id)
      await invoke('update_sound_order', { soundIds })
      addLog('Sound order updated', 'success')
    } catch (error) {
      addLog(`Failed to update order: ${error}`, 'error')
      // Reload sounds on error
      loadSounds()
    }

    setDraggedSound(null)
    setDragOverSound(null)
  }

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
              data-sound-id={sound.id}
              className={`sound-card ${draggedSound === sound.id ? 'dragging' : ''} ${dragOverSound === sound.id ? 'drag-over' : ''}`}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, sound.id)}
              onDragEnd={(e) => handleDragEnd(e)}
              onDragOver={(e) => handleDragOver(e, sound.id)}
              onDragLeave={(e) => handleDragLeave(e)}
              onDrop={(e) => handleDrop(e, sound.id)}
            >
              <button
                className={`sound-btn ${playingSound === sound.id ? 'playing' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  playSound(sound.id)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                draggable={false}
              >
                <span className="sound-btn-name">{sound.name}</span>
                {sound.keybind && (
                  <span className="sound-btn-keybind">{sound.keybind}</span>
                )}
              </button>
              <button
                className="sound-edit-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingSound(sound)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Edit sound"
                draggable={false}
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
                          addLog('Stop All keybind cleared', 'info')
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
                      onChange={(e) => setOverlapMode(e.target.checked)}
                    />
                    <span>Allow sound overlap</span>
                  </label>
                  <p className="settings-hint">Play multiple sounds at once</p>
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
                          addLog('Keybind cleared', 'info')
                        }}
                      >
                        X
                      </button>
                    )}
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
