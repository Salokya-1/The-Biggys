import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/auth.dart';
import '../core/data.dart';
import '../widgets/common.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(notificationsProvider);
    final user = ref.watch(authProvider).user!;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              try {
                await ref.read(apiProvider).post('/api/notifications/read');
                ref.invalidate(notificationsProvider);
              } catch (_) {}
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: q.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(message: e.toString(), onRetry: () => ref.invalidate(notificationsProvider)),
        data: (c) {
          final items = ((c.data as Map)['items'] as List).cast<Map<String, dynamic>>();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(notificationsProvider),
            child: ListView(children: [
              StaleBanner(stale: c.stale, syncedAt: c.syncedAt),
              if (items.isEmpty) const EmptyState(icon: Icons.notifications_none, title: 'No notifications'),
              for (final n in items)
                ListTile(
                  leading: Icon(
                    switch (n['type'] as String) { 'seat.allocated' => Icons.event_seat, 'result.published' || 'result.updated' => Icons.school, _ => Icons.fact_check },
                    color: n['readAt'] == null ? Theme.of(context).colorScheme.primary : Colors.grey,
                  ),
                  title: Text(n['title'] as String, style: TextStyle(fontWeight: n['readAt'] == null ? FontWeight.w600 : FontWeight.normal)),
                  subtitle: Text('${n['body']}\n${fmtDateTime(n['createdAt'] as String)}'),
                  isThreeLine: true,
                  onTap: () {
                    final p = n['payload'] as Map<String, dynamic>?;
                    if (user.isStaff && p?['markSheetId'] != null) context.push('/sheet/${p!['markSheetId']}');
                  },
                ),
            ]),
          );
        },
      ),
    );
  }
}
