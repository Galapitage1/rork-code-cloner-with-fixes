import React, { useState, useRef } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { Search, Mic, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Audio } from 'expo-av';

interface VoiceSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  style?: any;
  inputStyle?: any;
}

export function VoiceSearchInput({
  value,
  onChangeText,
  placeholder = 'Search...',
  placeholderTextColor = Colors.light.muted,
  style,
  inputStyle,
}: VoiceSearchInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecordingWeb = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording on web:', error);
      Alert.alert('Error', 'Failed to access microphone. Please check permissions.');
    }
  };

  const stopRecordingWeb = async () => {
    if (!mediaRecorderRef.current) return;

    return new Promise<void>((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!;

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        mediaRecorder.stream.getTracks().forEach(track => track.stop());

        await transcribeAudio(audioBlob);
        resolve();
      };

      mediaRecorder.stop();
      setIsRecording(false);
    });
  };

  const startRecordingNative = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow microphone access to use voice search.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording on native:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecordingNative = async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recordingRef.current.getURI();
      if (!uri) {
        Alert.alert('Error', 'Failed to get recording.');
        return;
      }

      const uriParts = uri.split('.');
      const fileType = uriParts[uriParts.length - 1];

      const audioFile = {
        uri,
        name: `recording.${fileType}`,
        type: `audio/${fileType}`,
      };

      await transcribeAudioNative(audioFile);
    } catch (error) {
      console.error('Error stopping recording on native:', error);
      Alert.alert('Error', 'Failed to process recording.');
    } finally {
      recordingRef.current = null;
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      setIsTranscribing(true);

      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch('https://toolkit.rork.com/stt/transcribe/', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      if (data.text) {
        onChangeText(data.text);
      } else {
        Alert.alert('No Speech Detected', 'Please try again and speak clearly.');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      Alert.alert('Error', 'Failed to transcribe audio. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const transcribeAudioNative = async (audioFile: { uri: string; name: string; type: string }) => {
    try {
      setIsTranscribing(true);

      const formData = new FormData();
      formData.append('audio', audioFile as any);

      const response = await fetch('https://toolkit.rork.com/stt/transcribe/', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      if (data.text) {
        onChangeText(data.text);
      } else {
        Alert.alert('No Speech Detected', 'Please try again and speak clearly.');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      Alert.alert('Error', 'Failed to transcribe audio. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleMicPress = async () => {
    if (isRecording) {
      if (Platform.OS === 'web') {
        await stopRecordingWeb();
      } else {
        await stopRecordingNative();
      }
    } else {
      if (Platform.OS === 'web') {
        await startRecordingWeb();
      } else {
        await startRecordingNative();
      }
    }
  };

  const handleClear = () => {
    onChangeText('');
  };

  return (
    <View style={[styles.container, style]}>
      <Search size={20} color={Colors.light.icon} />
      <TextInput
        style={[styles.input, inputStyle]}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={placeholderTextColor}
      />
      {value.length > 0 && !isRecording && !isTranscribing && (
        <TouchableOpacity onPress={handleClear} style={styles.iconButton}>
          <X size={20} color={Colors.light.icon} />
        </TouchableOpacity>
      )}
      <TouchableOpacity 
        onPress={handleMicPress} 
        style={[styles.iconButton, isRecording && styles.recordingButton]}
        disabled={isTranscribing}
      >
        {isTranscribing ? (
          <ActivityIndicator size="small" color={Colors.light.tint} />
        ) : (
          <Mic size={20} color={isRecording ? '#fff' : Colors.light.tint} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  iconButton: {
    padding: 4,
  },
  recordingButton: {
    backgroundColor: Colors.light.danger,
    borderRadius: 16,
    padding: 6,
  },
});
