import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { newId } from '../app/uuid';
import type { UploadRunner } from '../core/runner';
import type { ImageFile } from '../core/types';
import { MAX_DESCRIPTION_LENGTH, MAX_IMAGES, ValidationError } from '../core/validation';
import { Button } from '../components/Button';
import { hasCameraAccess, requestCameraAccess } from '../native/cameraPermission';
import { deletePhoto, pickPhotos, preparePhoto, takePhoto } from '../native/photos';
import { colors, TAP } from '../theme';

interface Slot {
  key: string;
  status: 'preparing' | 'ready' | 'error';
  image?: ImageFile;
}

interface Props {
  runner: UploadRunner;
  onDone: () => void;
  onCancel: () => void;
}

export function ComposeScreen({ runner, onDone, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [camera, setCamera] = useState<'denied' | 'blocked' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Photos belong to the report only once it is saved; until then we clean up after ourselves.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const saved = useRef(false);
  const discardPhotos = useCallback(() => {
    slotsRef.current.forEach(slot => slot.image && deletePhoto(slot.image.uri));
  }, []);

  const ready = slots.filter(s => s.status === 'ready');
  const preparing = slots.some(s => s.status === 'preparing');
  const dirty = description.trim().length > 0 || slots.length > 0;
  const canSave = description.trim().length > 0 && ready.length >= 1 && !preparing && !saving;

  const leave = useCallback(() => {
    const exit = () => {
      discardPhotos();
      onCancel();
    };
    if (!dirty) {
      onCancel();
      return;
    }
    Alert.alert('Discard this report?', 'It has not been saved yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: exit },
    ]);
  }, [dirty, discardPhotos, onCancel]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
  }, [leave]);

  // If the person grants camera access in Settings and comes back, clear the notice without a restart.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async next => {
      if (next === 'active' && (await hasCameraAccess())) {
        setCamera(null);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(
    () => () => {
      if (!saved.current) {
        discardPhotos();
      }
    },
    [discardPhotos],
  );

  const addPhotos = async (uris: string[]) => {
    const room = MAX_IMAGES - slotsRef.current.length;
    for (const uri of uris.slice(0, Math.max(room, 0))) {
      const key = newId();
      setSlots(prev => [...prev, { key, status: 'preparing' }]);
      try {
        const image = await preparePhoto(uri);
        setSlots(prev => prev.map(s => (s.key === key ? { key, status: 'ready', image } : s)));
      } catch {
        setSlots(prev => prev.map(s => (s.key === key ? { key, status: 'error' } : s)));
      }
    }
  };

  const onTake = async () => {
    setError(null);
    if (!(await hasCameraAccess())) {
      const access = await requestCameraAccess();
      if (access !== 'granted') {
        setCamera(access);
        return;
      }
    }
    setCamera(null);
    try {
      await addPhotos(await takePhoto());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The camera could not be opened.');
    }
  };

  const onChoose = async () => {
    setError(null);
    try {
      await addPhotos(await pickPhotos(MAX_IMAGES - slotsRef.current.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The gallery could not be opened.');
    }
  };

  const removeSlot = (slot: Slot) => {
    if (slot.image) {
      deletePhoto(slot.image.uri);
    }
    setSlots(prev => prev.filter(s => s.key !== slot.key));
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await runner.enqueue({ description, images: ready.map(s => s.image as ImageFile) });
      saved.current = true;
      onDone();
    } catch (e) {
      setSaving(false);
      setError(e instanceof ValidationError ? e.message : 'Could not save this report on the phone. Try again.');
    }
  };

  const full = slots.length >= MAX_IMAGES;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={leave} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          New report
        </Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.label}>What did you find?</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Short description"
          placeholderTextColor={colors.inkSoft}
          multiline
          maxLength={MAX_DESCRIPTION_LENGTH}
          textAlignVertical="top"
          style={styles.input}
          accessibilityLabel="Description"
        />

        <Text style={styles.label}>
          Photos ({slots.length}/{MAX_IMAGES})
        </Text>
        <View style={styles.photoButtons}>
          <View style={styles.flex}>
            <Button label="Take photo" onPress={onTake} disabled={full} />
          </View>
          <View style={styles.flex}>
            <Button label="Choose photos" onPress={onChoose} disabled={full} />
          </View>
        </View>

        {camera ? (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={styles.noticeText}>
              {camera === 'blocked'
                ? 'Camera access is turned off for this app. Turn it on in Settings to take photos, or choose photos from your gallery.'
                : 'The camera needs your permission to take photos. You can still choose photos from your gallery.'}
            </Text>
            <Button
              label={camera === 'blocked' ? 'Open Settings' : 'Allow camera'}
              onPress={camera === 'blocked' ? () => Linking.openSettings() : onTake}
            />
          </View>
        ) : null}

        <View style={styles.grid}>
          {slots.map(slot => (
            <View key={slot.key} style={styles.slot}>
              {slot.status === 'ready' ? (
                <Image source={{ uri: slot.image?.uri }} style={styles.slotImage} accessibilityIgnoresInvertColors />
              ) : slot.status === 'preparing' ? (
                <View style={styles.slotCentered}>
                  <ActivityIndicator />
                  <Text style={styles.slotText}>Preparing</Text>
                </View>
              ) : (
                <View style={styles.slotCentered}>
                  <Text style={[styles.slotText, { color: colors.danger }]}>Couldn't use this photo</Text>
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                onPress={() => removeSlot(slot)}
                style={styles.remove}>
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Button label={saving ? 'Saving…' : 'Save report'} kind="primary" onPress={onSave} disabled={!canSave} />
        <Text style={styles.hint}>
          {canSave
            ? 'Saving keeps it on this phone and uploads it whenever there is a connection.'
            : 'Add a description and at least one photo.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 56 },
  back: { minWidth: 72, minHeight: TAP, justifyContent: 'center', paddingHorizontal: 8 },
  backText: { fontSize: 16, color: colors.accent, fontWeight: '600' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.ink },
  content: { paddingHorizontal: 16, gap: 12 },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 4 },
  input: {
    minHeight: 110,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.ink,
  },
  photoButtons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  notice: { backgroundColor: '#FBEFDF', borderLeftWidth: 5, borderLeftColor: '#E08A34', borderRadius: 8, padding: 12, gap: 10 },
  noticeText: { fontSize: 14, color: '#7A4A12' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { width: 100, height: 100, borderRadius: 10, backgroundColor: colors.line, overflow: 'hidden' },
  slotImage: { width: 100, height: 100 },
  slotCentered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4 },
  slotText: { fontSize: 12, color: colors.inkSoft, textAlign: 'center' },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: TAP,
    height: TAP,
    alignItems: 'flex-end',
    paddingTop: 4,
    paddingRight: 8,
  },
  removeText: { fontSize: 24, lineHeight: 26, color: '#fff', fontWeight: '700', textShadowColor: '#000', textShadowRadius: 3 },
  error: { fontSize: 14, color: colors.danger },
  hint: { fontSize: 13, color: colors.inkSoft, textAlign: 'center' },
});
