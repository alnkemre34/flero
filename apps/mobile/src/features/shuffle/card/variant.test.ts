// Run: node --test src/features/shuffle/card/variant.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardVariant } from './variant.ts';

test('server-confirmed paid placement is BOOST, whatever the membership', () => {
  assert.deepEqual(cardVariant({ placement: 'BOOST_BLOCK', membership_tier: 'STANDARD' }), { variant: 'BOOST', plusMember: false });
  // Plus + Boost: still the BOOST design, with the secondary Plus mark — never a fourth design
  assert.deepEqual(cardVariant({ placement: 'BOOST_BLOCK', membership_tier: 'PLUS' }), { variant: 'BOOST', plusMember: true });
});

test('without a promoted placement the membership decides', () => {
  assert.deepEqual(cardVariant({ placement: 'DISCOVERY', membership_tier: 'PLUS' }), { variant: 'PLUS', plusMember: true });
  assert.deepEqual(cardVariant({ placement: 'DISCOVERY', membership_tier: 'STANDARD' }), { variant: 'STANDARD', plusMember: false });
});

test('an active Boost owner drawn organically (DISCOVERY) is not shown as promoted', () => {
  // the input has no "owns Boost" flag on purpose: only the server placement can make a card BOOST
  assert.equal(cardVariant({ placement: 'DISCOVERY', membership_tier: 'STANDARD' }).variant, 'STANDARD');
});
