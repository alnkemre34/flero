import type { MediaView, OneViewLease } from '@flero/contracts';
import type { z } from 'zod';
import { postToTicket, type PickedImage } from './avatar';
import { api, ApiError, newKey } from './client';

/**
 * Chat photos (doc 08 §8). Upload = ticket → original into quarantine → server re-encodes, scans and posts the
 * PHOTO message. The recipient pays Gold to unlock (never twice); a one-view photo opens through a single-use lease.
 */
export type MediaKind = 'PERSISTENT' | 'ONE_VIEW';
export type MediaViewT = z.infer<typeof MediaView>;
type Ticket = { media_id: string; url: string; fields: Record<string, string> };

export async function sendChatPhoto(cid: string, img: PickedImage, kind: MediaKind): Promise<MediaViewT> {
  const ticket = (await api<Ticket>(`/v1/conversations/${cid}/media/uploads`, { body: { kind, content_type: img.contentType, byte_size: Math.max(1, img.size) } })).data;
  await postToTicket(ticket, img);
  return (await api<MediaViewT>(`/v1/media/${ticket.media_id}/complete`, { body: {} })).data;
}

export const getMedia = (mid: string) => api<MediaViewT>(`/v1/media/${mid}`).then((r) => r.data);
export const unlockMedia = (mid: string) => api<MediaViewT>(`/v1/media/${mid}/unlock`, { body: {}, idem: newKey() }).then((r) => r.data);
export const openOneView = (mid: string) => api<z.infer<typeof OneViewLease>>(`/v1/media/${mid}/open`, { body: {}, idem: newKey() }).then((r) => r.data);
export const renderedOneView = (mid: string, leaseId: string) =>
  api<MediaViewT>(`/v1/media/${mid}/rendered`, { body: { lease_id: leaseId }, idem: newKey() }).then((r) => r.data);

export function mediaErrorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  const reason = e instanceof ApiError ? e.params?.reason : undefined;
  if (code === 'INSUFFICIENT_GOLD') return reason === 'debt' ? 'Cüzdanında bekleyen bir borç var; önce onu kapatmalısın.' : 'Yeterli Gold’un yok. Cüzdan’dan Gold alabilirsin.';
  if (reason === 'consumed') return 'Bu tek görüntülük fotoğraf zaten açıldı.';
  if (reason === 'media_unavailable') return 'Bu fotoğrafın süresi doldu.';
  if (reason === 'policy') return 'Bu fotoğraf topluluk kurallarına uymuyor. Başka bir fotoğraf dene.';
  if (reason === 'unreadable') return 'Bu dosya okunamadı. Başka bir fotoğraf dene.';
  if (code === 'PERMISSION_DENIED') return 'Fotoğraflarına erişim izni gerekiyor. Ayarlardan izin verebilirsin.';
  if (code === 'IMAGE_TOO_SMALL') return 'Fotoğraf en az 256 piksel olmalı.';
  if (code === 'IMAGE_TOO_LARGE') return 'Fotoğraf 15 MB’tan küçük olmalı.';
  if (code === 'IMAGE_TYPE') return 'JPEG, PNG ya da HEIC formatında bir fotoğraf seç.';
  if (code === 'RATE_LIMITED') return 'Çok fazla fotoğraf gönderdin. Biraz sonra tekrar dene.';
  if (code === 'ACTION_UNAVAILABLE') return 'Bu sohbete şu an fotoğraf gönderilemiyor.';
  if (code === 'NETWORK') return 'Bağlantı yok. İnternetini kontrol edip tekrar dene.';
  if (code === 'TEMPORARILY_UNAVAILABLE') return 'Fotoğraf gönderimi şu an kullanılamıyor. Biraz sonra tekrar dene.';
  return 'Bir sorun oluştu. Tekrar dene.';
}
