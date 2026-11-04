import ReactNativeBlobUtil from 'react-native-blob-util';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import { launchCamera, launchImageLibrary, type ImagePickerResponse } from 'react-native-image-picker';

import { prepareImage, type Resizer } from '../core/imagePipeline';
import type { ImageFile } from '../core/types';

const { fs } = ReactNativeBlobUtil;
/** App-private and durable, unlike the cache directory the OS may clear while a report waits. */
const PHOTO_DIR = `${fs.dirs.DocumentDir}/photos`;

const resize: Resizer = async (sourceUri, maxDimension, quality) => {
  await fs.mkdir(PHOTO_DIR).catch(() => {}); // already exists
  const result = await ImageResizer.createResizedImage(sourceUri, maxDimension, maxDimension, 'JPEG', quality, 0, PHOTO_DIR, false, {
    mode: 'contain',
    onlyScaleDown: true,
  });
  return { uri: result.uri, bytes: result.size };
};

export const deletePhoto = (uri: string): Promise<void> => fs.unlink(uri.replace(/^file:\/\//, '')).catch(() => {});

/** Removes every stored photo, including ones left behind by reports that were never saved. */
export const clearPhotos = (): Promise<void> => fs.unlink(PHOTO_DIR).catch(() => {});

/** Deletes every stored photo that is not in `keep` (the photos of saved reports and of the draft). */
export async function sweepPhotos(keep: string[]): Promise<void> {
  const names = new Set(keep.map(uri => uri.split('/').pop()));
  const files = await fs.ls(PHOTO_DIR).catch(() => [] as string[]);
  await Promise.all(files.filter(name => !names.has(name)).map(name => fs.unlink(`${PHOTO_DIR}/${name}`).catch(() => {})));
}

/** Shrinks a picked or captured photo to something sendable and stores it durably. */
export function preparePhoto(sourceUri: string): Promise<ImageFile> {
  return prepareImage(sourceUri, resize, deletePhoto);
}

function uris(response: ImagePickerResponse): string[] {
  if (response.didCancel) {
    return [];
  }
  if (response.errorCode) {
    throw new Error(response.errorMessage ?? response.errorCode);
  }
  return (response.assets ?? []).flatMap(asset => (asset.uri ? [asset.uri] : []));
}

export async function takePhoto(): Promise<string[]> {
  return uris(await launchCamera({ mediaType: 'photo', saveToPhotos: false, cameraType: 'back' }));
}

export async function pickPhotos(limit: number): Promise<string[]> {
  return uris(await launchImageLibrary({ mediaType: 'photo', selectionLimit: limit }));
}
