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
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.school, size: 56),
          const SizedBox(height: 12),
          const Text('RTE IMS', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 24),
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(waking ? 'Server waking up…' : 'Loading…', style: Theme.of(context).textTheme.bodySmall),
        ]),
      ),
    );
  }
}
