import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export const palette = {
  base: '#080B12', panel: '#0E1420', user: '#082B60', assistant: '#171C26',
  blue: '#1677FF', blueDark: '#104A99', text: '#F5F7FC', muted: '#9DA9BD', border: '#263247',
};

const paths = {
  chat: 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-5a7.5 7.5 0 0 1-1-4.5A7.5 7.5 0 0 1 10.5 4h2a7.5 7.5 0 0 1 7.5 7.5ZM8 11.5h.1m3.9 0h.1m3.9 0h.1',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  flask: 'M9 3h6m-5 0v7l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3M8 15h8',
  settings: 'M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-6 1v4',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1.5 4.5L21 21',
  plus: 'M12 5v14M5 12h14',
  mic: 'M9 6a3 3 0 1 1 6 0v6a3 3 0 1 1-6 0V6Zm-3 5v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6',
  send: 'm3 4 18 8-18 8 4-8-4-8Zm4 8h14',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  chart: 'M5 20v-6m5 6V9m5 11V4m5 16v-9',
  idea: 'M9 18h6m-5 3h4m-5-5v-2a6 6 0 1 1 6 0v2',
  more: 'M5 12h.1m6.9 0h.1m6.9 0h.1',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v8H5v-8a1 1 0 0 1 1-1Z',
  down: 'm6 9 6 6 6-6',
};
export type IconName = keyof typeof paths;
export function Icon({ name, color = palette.muted, size = 21 }: {name: IconName; color?: string; size?: number}) {
  return <Svg accessible={false} width={size} height={size} viewBox="0 0 24 24">
    <Path d={paths[name]} stroke={color} strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>;
}
export function IconButton({ name, label, onPress, accent = false, disabled = false }: {
  name: IconName; label: string; onPress: () => void; accent?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({pressed}) => [v.iconButton, accent && v.accentButton, pressed && v.pressed, disabled && v.disabled]}>
    <Icon name={name} color={accent ? palette.text : palette.muted} />
  </Pressable>;
}

export type AvatarState = 'neutral' | 'listening' | 'thinking' | 'speaking' | 'offline';
const statusColors = {neutral: '#68C7A7', listening: '#97C7FF', thinking: '#74A9FF', speaking: '#B5A3FF', offline: '#8190A8'};
export function Avatar({ state = 'neutral', small = false, ring = palette.blueDark }: {
  state?: AvatarState; small?: boolean; ring?: string;
}) {
  return <View accessible={false} style={[v.avatar, small && v.small, {borderColor: ring}]}>
    <Image source={require('./assets/portrait.png')} style={v.portrait} />
    {!small && <View style={[v.avatarDot, {backgroundColor: statusColors[state]}]} />}
  </View>;
}

export function Atmosphere() {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let active = true;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let reduce = true;
    let animation: Animated.CompositeAnimation | undefined;
    function sync() {
      animation?.stop();
      progress.setValue(0);
      if (!active || !foreground || reduce) return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(progress, {toValue: 1, duration: 14500, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false}),
        Animated.timing(progress, {toValue: 0, duration: 14500, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false}),
      ]));
      animation.start();
    }
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) { reduce = value; sync(); } }).catch(() => {});
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reduce = value; sync(); });
    const appState = AppState.addEventListener('change', state => { foreground = state === 'active'; sync(); });
    return () => { active = false; animation?.stop(); accessibility.remove(); appState.remove(); };
  }, [progress]);
  return <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <Animated.Image source={require('./assets/atmosphere.png')} resizeMode="stretch" style={[v.smoke, v.smokeTop, {
      transform: [{translateY: progress.interpolate({inputRange: [0, 1], outputRange: [0, 26]})}],
    }]} />
    <Animated.Image source={require('./assets/atmosphere.png')} resizeMode="stretch" style={[v.smoke, v.smokeBottom, {
      transform: [{rotate: '180deg'}, {translateX: progress.interpolate({inputRange: [0, 1], outputRange: [0, 28]})}],
    }]} />
  </View>;
}
const v = StyleSheet.create({
  iconButton: {width: 44, height: 44, borderRadius: 15, backgroundColor: '#0D1624', borderWidth: 1,
    borderColor: '#21334E', justifyContent: 'center', alignItems: 'center'},
  accentButton: {backgroundColor: palette.blue, borderColor: '#4B97FF'},
  pressed: {opacity: .72}, disabled: {opacity: .38},
  avatar: {width: 57, height: 57, borderRadius: 29, padding: 2, borderWidth: 1.5, backgroundColor: '#0B1626'},
  small: {width: 31, height: 31, borderRadius: 16, padding: 1, borderWidth: 1},
  portrait: {width: '100%', height: '100%', borderRadius: 40},
  avatarDot: {width: 10, height: 10, borderRadius: 5, borderColor: palette.base, borderWidth: 1,
    position: 'absolute', right: 0, bottom: 0},
  smoke: {position: 'absolute', width: '105%', height: '56%', opacity: .58},
  smokeTop: {top: -40, right: -92}, smokeBottom: {bottom: -42, left: -98, opacity: .46},
});
