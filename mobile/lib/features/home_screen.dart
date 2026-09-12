import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth.dart';
import '../core/data.dart';
import '../widgets/common.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user!;
    return Scaffold(
      appBar: AppBar(title: Text('Hi, ${user.name.split(' ').first}')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(profileProvider);
          ref.invalidate(examsProvider);
          ref.invalidate(notificationsProvider);
          ref.invalidate(sheetsProvider);
        },
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (user.isStudent) ...[const _NextExamCard(), const SizedBox(height: 12), const _LatestResultCard()] else const _QueueCard(),
          const SizedBox(height: 12),
          const _AlertsCard(),
        ]),
      ),
    );
  }
}

class _NextExamCard extends ConsumerWidget {
  const _NextExamCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(examsProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: q.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => Text('Next exam: $e'),
          data: (c) {
            final list = (c.data as List).cast<Map<String, dynamic>>();
            final now = DateTime.now();
            final next = list.where((s) => DateTime.parse(s['date'] as String).isAfter(now.subtract(const Duration(days: 1)))).firstOrNull;
            if (next == null) return const Text('No upcoming exams.');
            final seat = next['seat'] as Map<String, dynamic>?;
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Next exam', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              Text(next['title'] as String, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('${fmtDate(next['date'] as String)} · ${next['startTime']} · ${next['durationMin']} min'),
              const SizedBox(height: 6),
              seat == null
                  ? const Text('Seat not yet released', style: TextStyle(color: Colors.grey))
                  : Text('${seat['venue']['name']} · seat ${seat['seatLabel']}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.primary)),
            ]);
          },
        ),
      ),
    );
  }
}

class _LatestResultCard extends ConsumerWidget {
  const _LatestResultCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(profileProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: q.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => Text('Results: $e'),
          data: (c) {
            final sems = ((c.data as Map)['semesters'] as List).cast<Map<String, dynamic>>();
            final published = sems.expand((s) => (s['modules'] as List).cast<Map<String, dynamic>>()).where((m) => m['result'] != null).toList();
            published.sort((a, b) => ((b['result']['publishedAt'] ?? '') as String).compareTo((a['result']['publishedAt'] ?? '') as String));
            final stats = (c.data as Map)['stats'] as Map<String, dynamic>;
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Latest published result', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              if (published.isEmpty)
                const Text('No results published yet.')
              else
                Row(children: [
                  Expanded(child: Text('${published.first['module']['code']} · ${published.first['module']['title']}', style: const TextStyle(fontWeight: FontWeight.w600))),
                  Pill('${published.first['result']['grade']} · ${published.first['result']['outcome']}', color: outcomeColor(published.first['result']['outcome'] as String?)),
                ]),
              const SizedBox(height: 8),
              Text('${stats['passed']} passed · ${stats['resits']} resits · ${stats['pending']} awaiting publication', style: Theme.of(context).textTheme.bodySmall),
            ]);
          },
        ),
      ),
    );
  }
}

class _QueueCard extends ConsumerWidget {
  const _QueueCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(sheetsProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: q.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => Text('Queue: $e'),
          data: (c) {
            final list = (c.data as List).cast<Map<String, dynamic>>();
            int n(String s) => list.where((x) => x['status'] == s).length;
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Result pipeline', style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final s in ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED']) Pill('${s.replaceAll('_', ' ')} ${n(s)}', color: statusColor(s)),
              ]),
              const SizedBox(height: 8),
              Text(n('SUBMITTED') + n('UNDER_REVIEW') > 0 ? '${n('SUBMITTED') + n('UNDER_REVIEW')} sheet(s) waiting for review — open the Sheets tab.' : 'Nothing waiting for review.', style: Theme.of(context).textTheme.bodySmall),
            ]);
          },
        ),
      ),
    );
  }
}

class _AlertsCard extends ConsumerWidget {
  const _AlertsCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(notificationsProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: q.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => Text('Alerts: $e'),
          data: (c) {
            final m = c.data as Map<String, dynamic>;
            final items = (m['items'] as List).cast<Map<String, dynamic>>().take(3).toList();
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text('Alerts', style: Theme.of(context).textTheme.labelLarge),
                const Spacer(),
                if ((m['unread'] as int) > 0) Pill('${m['unread']} new', color: Colors.red.shade100),
              ]),
              const SizedBox(height: 6),
              if (items.isEmpty) const Text('No notifications.'),
              for (final n in items)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(n['title'] as String, style: TextStyle(fontWeight: n['readAt'] == null ? FontWeight.w600 : FontWeight.normal)),
                  subtitle: Text(fmtDateTime(n['createdAt'] as String)),
                  onTap: () {
                    final p = n['payload'] as Map<String, dynamic>?;
                    if (p?['markSheetId'] != null && !ref.read(authProvider).user!.isStudent) context.push('/sheet/${p!['markSheetId']}');
                  },
                ),
            ]);
          },
        ),
      ),
    );
  }
}
