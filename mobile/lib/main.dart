import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/router.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: RteApp()));
}

class RteApp extends ConsumerWidget {
  const RteApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final scheme = ColorScheme.fromSeed(seedColor: const Color(0xFF1E3A8A));
    return MaterialApp.router(
      title: 'RTE IMS',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: scheme,
        useMaterial3: true,
        cardTheme: const CardThemeData(elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12)))),
        inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
      ),
      routerConfig: router,
    );
  }
}
