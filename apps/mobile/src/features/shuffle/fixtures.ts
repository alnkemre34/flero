import { ShuffleSampleResponse } from '@flero/contracts';

/**
 * Prototype fixture: one NORMAL batch (N=10) covering every card variant of doc 14 §5.
 * Parsed with the real contract schema, so ordering/badge/duplicate rules are enforced at load time.
 */
const id = (ch: string) => `usr_${ch.repeat(26)}`;
const card = (
  rank: number, ch: string, name: string, district: string,
  placement: 'BOOST_BLOCK' | 'DISCOVERY', tier: 'STANDARD' | 'PLUS', gender: 'FEMALE' | 'MALE',
) => ({
  public_user_id: id(ch), presentation_rank: rank, placement, membership_tier: tier,
  display_name: name, avatar: null, home_city_label_key: 'geo.city.istanbul',
  home_district_label_key: `geo.district.${district}`, gender,
  card_badges: [...(placement === 'BOOST_BLOCK' ? ['badge.promoted'] : []), ...(tier === 'PLUS' ? ['badge.plus'] : [])],
});

export const NORMAL_BATCH = ShuffleSampleResponse.parse({
  batch_id: 'bat_prototype0000000001',
  mode: 'DISTRICT',
  applied: { gender: 'ALL', shuffle_batch_size: 10, district_id: 'dst_3401', config_version: 'cfg_proto' },
  selection_mode: 'NORMAL',
  completion: 'FULL',
  has_more: true,
  items: [
    card(0, 'a', 'Elif', 'kadikoy', 'BOOST_BLOCK', 'PLUS', 'FEMALE'),
    card(1, 'b', 'Kerem', 'besiktas', 'BOOST_BLOCK', 'STANDARD', 'MALE'),
    card(2, 'c', 'Şebnem Çağlayan-Öztürk', 'kadikoy', 'BOOST_BLOCK', 'STANDARD', 'FEMALE'),
    card(3, 'd', 'Deniz', 'uskudar', 'DISCOVERY', 'PLUS', 'MALE'),
    card(4, 'e', 'İpek', 'kadikoy', 'DISCOVERY', 'PLUS', 'FEMALE'),
    card(5, 'f', 'Ilgaz', 'kadikoy', 'DISCOVERY', 'STANDARD', 'MALE'),
    card(6, 'g', 'Gülşen', 'sisli', 'DISCOVERY', 'STANDARD', 'FEMALE'),
    card(7, 'h', 'Barış', 'kadikoy', 'DISCOVERY', 'STANDARD', 'MALE'),
    card(8, 'i', 'Ümran', 'kadikoy', 'DISCOVERY', 'STANDARD', 'FEMALE'),
    card(9, 'j', 'Can', 'esenyurt', 'DISCOVERY', 'STANDARD', 'MALE'),
  ],
});

export type ShuffleItem = (typeof NORMAL_BATCH.items)[number];
