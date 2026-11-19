import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { useTheme } from '@/design/theme';

/** WhatsApp-style status of MY message: sending (clock) → sent ✓ → delivered ✓✓ → read ✓✓ (accent). */
export type Tick = 'sending' | 'sent' | 'delivered' | 'read';
const LABEL: Record<Tick, string> = { sending: 'Gönderiliyor', sent: 'Gönderildi', delivered: 'Teslim edildi', read: 'Okundu' };

/** `onMedia`: drawn over a photo (white, read stays the accent) instead of on the chat background. */
export function TickIcon({ tick, onMedia, color }: { tick: Tick; onMedia?: boolean; color?: string }) {
  const { c } = useTheme();
  const name = tick === 'sending' ? 'time-outline' : tick === 'sent' ? 'checkmark' : 'checkmark-done';
  const tint = tick === 'read' ? (onMedia ? '#5CE1FF' : c.promotedAccent) : (color ?? (onMedia ? 'rgba(255,255,255,0.92)' : c.textTertiary));
  return (
    <View accessible accessibilityLabel={LABEL[tick]}>
      <Ionicons name={name} size={tick === 'sending' ? 13 : 16} color={tint} />
    </View>
  );
}
