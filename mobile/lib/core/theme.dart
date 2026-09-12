import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Islington College brand (islington.edu.np): indigo #41448B, blue #2F6AAF, orange #E37E3F.
/// Roboto is the site font and Android's default, so no font bundling is needed.
const kBrandIndigo = Color(0xFF41448B);
const kBrandBlue = Color(0xFF2F6AAF);
const kBrandOrange = Color(0xFFE37E3F);
const kBrandNavy = Color(0xFF2D2F53);

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  // Dark mode is true black with neutral greys; only actions keep the brand indigo.
  final scheme = ColorScheme.fromSeed(seedColor: kBrandIndigo, brightness: brightness).copyWith(
    primary: dark ? const Color(0xFF6F73D9) : kBrandIndigo,
    secondary: kBrandBlue,
    tertiary: kBrandOrange,
    surface: dark ? Colors.black : const Color(0xFFF5F6F7),
    surfaceContainerHighest: dark ? const Color(0xFF161616) : const Color(0xFFECEEF8),
    outlineVariant: dark ? const Color(0xFF262626) : const Color(0xFFE3E5EA),
  );
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    fontFamily: 'Roboto',
    scaffoldBackgroundColor: dark ? Colors.black : scheme.surface,
    appBarTheme: AppBarTheme(backgroundColor: dark ? Colors.black : kBrandNavy, foregroundColor: Colors.white, elevation: 0),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: dark ? const Color(0xFF0F0F0F) : Colors.white,
      indicatorColor: scheme.primary.withValues(alpha: dark ? 0.35 : 0.15),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: dark ? const Color(0xFF0F0F0F) : Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6), side: BorderSide(color: dark ? const Color(0xFF262626) : const Color(0xFFE3E5EA))),
    ),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(4)))),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(4))), textStyle: const TextStyle(fontWeight: FontWeight.w600, letterSpacing: 0.8)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(4))))),
  );
}

class ThemeModeNotifier extends Notifier<ThemeMode> {
  static const _key = 'themeMode';

  @override
  ThemeMode build() {
    SharedPreferences.getInstance().then((p) {
      final v = p.getString(_key);
      if (v != null) state = ThemeMode.values.firstWhere((m) => m.name == v, orElse: () => ThemeMode.system);
    });
    return ThemeMode.system;
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, mode.name);
  }

  /// Flip between light and dark (a "system" choice resolves to whatever is showing now).
  Future<void> toggle(Brightness currentBrightness) =>
      set(currentBrightness == Brightness.dark ? ThemeMode.light : ThemeMode.dark);
}

/// App-bar action: sun/moon switch between light and dark.
class ThemeToggleButton extends ConsumerWidget {
  const ThemeToggleButton({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return IconButton(
      tooltip: isDark ? 'Switch to light mode' : 'Switch to dark mode',
      icon: Icon(isDark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
      onPressed: () => ref.read(themeModeProvider.notifier).toggle(Theme.of(context).brightness),
    );
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);
