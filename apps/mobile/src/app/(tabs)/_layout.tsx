import Ionicons from '@expo/vector-icons/Ionicons';
import type { InboxEntry } from '@flero/contracts';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withSpring } from 'react-native-reanimated';
import { motion } from '@flero/ui-tokens';
import type { z } from 'zod';
import { api } from '@/api/client';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; label: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', label: 'tab.discover', icon: 'compass-outline', iconActive: 'compass' },
  { name: 'sohbetler', label: 'tab.chats', icon: 'chatbubbles-outline', iconActive: 'chatbubbles' },
  { name: 'cuzdan', label: 'tab.wallet', icon: 'wallet-outline', iconActive: 'wallet' },
  { name: 'profilim', label: 'tab.profile', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

/** Active tab gets a Volt pill that springs in (interruptible, UI thread); labels stay visible (doc 14 §11). */
function TabIcon({ focused, name, nameActive }: { focused: boolean; name: IconName; nameActive: IconName }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const pill = useAnimatedStyle(() => ({
    opacity: withSpring(focused ? 1 : 0, motion.spring.snappy),
    transform: [{ scaleX: reduced ? 1 : withSpring(focused ? 1 : 0.6, motion.spring.snappy) }],
  }));
  return (
    <View style={{ width: 56, height: 30, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 56, height: 30, borderRadius: 15, backgroundColor: c.brand }, pill]} />
      <Ionicons name={focused ? nameActive : name} size={21} color={focused ? c.onBrand : c.textTertiary} />
    </View>
  );
}

/** Unread badges: same queries the screens use, so realtime invalidation refreshes both at once. */
function useBadges() {
  const main = useQuery({ queryKey: ['inbox', 'main'], queryFn: () => api<z.infer<typeof InboxEntry>[]>('/v1/inbox?filter=main&limit=50').then((r) => r.data) });
  const reqs = useQuery({ queryKey: ['inbox', 'requests'], queryFn: () => api<z.infer<typeof InboxEntry>[]>('/v1/inbox?filter=requests&limit=50').then((r) => r.data) });
  const unreadChats = [...(main.data ?? []), ...(reqs.data ?? [])].filter((e) => e.unread_count > 0).length;
  return { sohbetler: unreadChats } as Record<string, number>;
}

export default function TabsLayout() {
  const { c } = useTheme();
  const badges = useBadges();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.textPrimary,
        tabBarInactiveTintColor: c.textTertiary,
        tabBarStyle: { backgroundColor: c.canvas, borderTopColor: c.hairline, borderTopWidth: 1, height: 84, paddingTop: 8 },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, marginTop: 2 },
        sceneStyle: { backgroundColor: c.canvas },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            ...(badges[tab.name] ? { tabBarBadge: badges[tab.name]! > 9 ? '9+' : badges[tab.name], tabBarBadgeStyle: { backgroundColor: c.brand, color: c.onBrand, fontFamily: fonts.bold, fontSize: 10 } } : {}),
            tabBarAccessibilityLabel: badges[tab.name] ? `${t(tab.label)}, ${badges[tab.name]} okunmamış` : t(tab.label),
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name={tab.icon} nameActive={tab.iconActive} />,
          }}
        />
      ))}
    </Tabs>
  );
}
