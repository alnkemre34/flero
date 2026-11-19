import { space } from '@flero/ui-tokens';
import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { NORMAL_BATCH, type ShuffleItem } from '@/features/shuffle/fixtures';
import { ShuffleCard } from '@/features/shuffle/ShuffleCard';

/**
 * M1.3 frame-time gate fixture (ADR-002): 500 cards = 50 independent appended batches of 10, keyed per batch
 * exactly like production infinite scroll (duplicate public ids across batches are legitimate, A§4).
 * Driven by `tools/perf/android-scroll-gate.sh` via deep link flero://perf-list.
 */
const BATCHES = 50;

export default function PerfList() {
  const data = useMemo(
    () =>
      Array.from({ length: BATCHES }, (_, b) =>
        NORMAL_BATCH.items.map((item) => ({ key: `bat_perf${String(b).padStart(4, '0')}:${item.public_user_id}`, item })),
      ).flat(),
    [],
  );
  const onPress = useCallback((_id: string) => {}, []);
  return (
    <View style={{ flex: 1, paddingTop: space.m }} testID="perf-list">
      <FlashList<{ key: string; item: ShuffleItem }>
        data={data}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) => <ShuffleCard item={row.item} onPress={onPress} />}
      />
    </View>
  );
}
