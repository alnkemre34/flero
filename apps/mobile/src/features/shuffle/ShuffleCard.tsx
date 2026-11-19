import { memo } from 'react';
import { DiscoveryCard, type DiscoveryCardData } from './card/DiscoveryCard';
import type { ShuffleItem } from './fixtures';

/** Shuffle API item → discovery card data. A straight field mapping: no ranking, no reordering, no inference. */
export const toCardData = (i: ShuffleItem): DiscoveryCardData => ({
  id: i.public_user_id, name: i.display_name, gender: i.gender,
  districtKey: i.home_district_label_key, cityKey: i.home_city_label_key, avatarUrl: i.avatar?.url ?? null,
  placement: i.placement, membership: i.membership_tier,
});

/** The Shuffle row (Keşfet). Visuals live in card/DiscoveryCard.tsx; this keeps the list's API unchanged. */
function ShuffleCardImpl({ item, onPress }: { item: ShuffleItem; onPress: (id: string) => void }) {
  return <DiscoveryCard data={toCardData(item)} onPress={onPress} />;
}
export const ShuffleCard = memo(ShuffleCardImpl);
