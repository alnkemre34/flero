import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api, ApiError } from './client';

export type PickSource = 'library' | 'camera';
export interface PickedImage { uri: string; width: number; height: number; contentType: 'image/jpeg' | 'image/png' | 'image/heif'; size: number; blob: Blob | null }
export interface Crop { x: number; y: number; size: number }
type Ticket = { upload_id: string; url: string; fields: Record<string, string> };

export const MIN_CROP_PX = 256; // server minimum (AvatarCompleteRequest)

/** Dev media/upload URLs point at the API host; the Android emulator reaches the host machine via 10.0.2.2. */
export const reachable = (url: string) => (Platform.OS === 'android' ? url.replace('://localhost', '://10.0.2.2') : url);

/** Pick a photo (no OS editor: cropping happens in FLERO's own square cropper). Returns null on cancel. */
export async function pickImage(source: PickSource): Promise<PickedImage | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new ApiError('PERMISSION_DENIED', 0);
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.92, exif: false };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  if (Math.min(a.width, a.height) < MIN_CROP_PX) throw new ApiError('IMAGE_TOO_SMALL', 400);
  const blob = Platform.OS === 'web' ? await (await fetch(a.uri)).blob() : null;
  const type = (a.mimeType ?? blob?.type ?? 'image/jpeg').toLowerCase();
  const contentType = type === 'image/png' ? 'image/png' : type.includes('heic') || type.includes('heif') ? 'image/heif' : type === 'image/jpeg' || type === 'image/jpg' ? 'image/jpeg' : null;
  if (!contentType) throw new ApiError('IMAGE_TYPE', 400);
  const size = a.fileSize ?? blob?.size ?? 1;
  if (size > 15_000_000) throw new ApiError('IMAGE_TOO_LARGE', 400);
  return { uri: a.uri, width: a.width, height: a.height, contentType, size, blob };
}

/** Ticket → multipart POST into quarantine → server crops + re-encodes with the square the user framed. */
export async function uploadAvatar(img: PickedImage, crop: Crop): Promise<void> {
  const ticket = (await api<Ticket>('/v1/me/avatar/uploads', { body: { content_type: img.contentType, byte_size: Math.max(1, img.size) } })).data;
  await postToTicket(ticket, img);
  await api(`/v1/me/avatar/uploads/${ticket.upload_id}/complete`, { body: { crop } });
}

/** Multipart POST of a picked image into the quarantine slot a ticket grants (S3 presigned POST in production). */
export async function postToTicket(ticket: { url: string; fields: Record<string, string> }, img: PickedImage) {
  const form = new FormData();
  for (const [k, v] of Object.entries(ticket.fields)) form.append(k, v);
  if (img.blob) form.append('file', img.blob, 'upload');
  else form.append('file', { uri: img.uri, name: 'upload', type: img.contentType } as unknown as Blob);
  const up = await fetch(reachable(ticket.url), { method: 'POST', body: form }).catch(() => null);
  if (!up) throw new ApiError('NETWORK', 0);
  if (!up.ok) throw new ApiError('VALIDATION_FAILED', up.status);
}

export const removeAvatar = () => api('/v1/me/avatar', { method: 'DELETE' });

export function avatarErrorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  const reason = e instanceof ApiError ? e.params?.reason : undefined;
  const field = e instanceof ApiError ? e.params?.field : undefined;
  if (code === 'PERMISSION_DENIED') return 'Fotoğraflarına erişim izni gerekiyor. Ayarlardan izin verebilirsin.';
  if (code === 'IMAGE_TOO_SMALL') return 'Fotoğraf en az 256×256 piksel olmalı.';
  if (code === 'IMAGE_TOO_LARGE') return 'Fotoğraf 15 MB’tan küçük olmalı.';
  if (code === 'IMAGE_TYPE') return 'JPEG, PNG ya da HEIC formatında bir fotoğraf seç.';
  if (field === 'crop') return 'Kırpma alanı fotoğrafın dışına taşıyor. Tekrar ayarla.';
  if (reason === 'policy') return 'Bu fotoğraf topluluk kurallarına uymuyor. Başka bir fotoğraf dene.';
  if (reason === 'unreadable') return 'Bu dosya okunamadı. Başka bir fotoğraf dene.';
  if (code === 'RATE_LIMITED') return 'Çok sık deneme yaptın. Biraz sonra tekrar dene.';
  if (code === 'TEMPORARILY_UNAVAILABLE') return 'Fotoğraf yükleme şu an kullanılamıyor. Biraz sonra tekrar dene.';
  if (code === 'NETWORK') return 'Bağlantı yok. İnternetini kontrol edip tekrar dene.';
  return 'Fotoğraf yüklenemedi. Tekrar dene.';
}
