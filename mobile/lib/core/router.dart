import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/login_screen.dart';
import '../features/availability_screen.dart';
import '../features/settings_screen.dart';
import '../features/sheet_screen.dart';
import '../features/shell.dart';
import '../features/splash_screen.dart';
import 'auth.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier(0);
  ref.listen(authProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final loc = state.matchedLocation;
      if (auth.loading) return loc == '/splash' ? null : '/splash';
      if (!auth.signedIn) return (loc == '/login' || loc == '/settings') ? null : '/login';
      if (loc == '/login' || loc == '/splash') return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
      GoRoute(path: '/availability', builder: (_, _) => const AvailabilityScreen()),
      GoRoute(path: '/', builder: (_, _) => const AppShell()),
      GoRoute(path: '/sheet/:id', builder: (_, state) => SheetScreen(id: state.pathParameters['id']!)),
    ],
  );
});
