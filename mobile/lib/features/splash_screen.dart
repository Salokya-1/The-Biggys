import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/auth.dart';

class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final waking = ref.watch(authProvider.select((s) => s.serverWaking));
    return Scaffold(
      body: Center(
        // The first thing anybody sees is the product and who made it, not the initials of an
        // internal system name.
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Image.asset('assets/brand/kramiq.png', height: 96, filterQuality: FilterQuality.medium),
          const SizedBox(height: 16),
          const Text('KramIQ', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
          const SizedBox(height: 4),
          Text('Developed by The Biggys', style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 28),
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(waking ? 'Server waking up…' : 'Loading…', style: Theme.of(context).textTheme.bodySmall),
        ]),
      ),
    );
  }
}
