import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/auth.dart';
import '../core/config.dart';
import '../core/data.dart';
import '../core/theme.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user!;
    final baseUrl = ref.watch(apiBaseUrlProvider).value ?? kDefaultApiUrl;
    final profile = user.isStudent ? ref.watch(profileProvider) : null;
    final s = profile?.value == null ? null : (profile!.value!.data as Map)['student'] as Map<String, dynamic>;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(
          child: ListTile(
            leading: CircleAvatar(child: Text(user.name.substring(0, 1))),
            title: Text(user.name),
            subtitle: Text('${user.email} · ${user.role.replaceAll('_', ' ')}'),
          ),
        ),
        if (s != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _row('Student ID', s['studentId'] as String),
                _row('Programme', '${s['programme']['code']} · ${s['programme']['name']}'),
                _row('Intake', s['intake']['label'] as String),
                _row('Current semester', s['currentSemester'] == null ? '—' : 'Semester ${s['currentSemester']['number']}'),
                _row('Status', s['status'] as String),
                _row('Standing', s['standing'] as String),
                if (s['specialNeedsSeating'] == true) _row('Seating', 'Special-needs seating arranged'),
              ]),
            ),
          ),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(children: [
            const Icon(Icons.brightness_6_outlined),
            const SizedBox(width: 16),
            const Expanded(child: Text('Appearance')),
            SegmentedButton<ThemeMode>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(value: ThemeMode.light, icon: Icon(Icons.light_mode_outlined), tooltip: 'Light'),
                ButtonSegment(value: ThemeMode.dark, icon: Icon(Icons.dark_mode_outlined), tooltip: 'Dark'),
                ButtonSegment(value: ThemeMode.system, icon: Icon(Icons.phone_android_outlined), tooltip: 'System'),
              ],
              selected: {ref.watch(themeModeProvider)},
              onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).set(s.first),
            ),
          ]),
        ),
        if (user.isStaff)
          ListTile(
            leading: const Icon(Icons.event_busy_outlined),
            title: const Text('My availability'),
            subtitle: const Text('Hours you cannot be given a class'),
            onTap: () => context.push('/availability'),
          ),
        ListTile(leading: const Icon(Icons.settings_outlined), title: const Text('API settings'), subtitle: Text(baseUrl), onTap: () => context.push('/settings')),
        ListTile(leading: const Icon(Icons.logout), title: const Text('Sign out'), onTap: () => ref.read(authProvider.notifier).logout()),
        const SizedBox(height: 16),
        Text('Read-only. Contact the RTE office to correct your details.', style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 130, child: Text(k, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(v)),
        ]),
      );
}
