import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/data.dart';
import '../widgets/common.dart';

class ExamsScreen extends ConsumerWidget {
  const ExamsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(examsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My exam seats')),
      body: q.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(message: e.toString(), onRetry: () => ref.invalidate(examsProvider)),
        data: (c) {
          final list = (c.data as List).cast<Map<String, dynamic>>();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(examsProvider),
            child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
              StaleBanner(stale: c.stale, syncedAt: c.syncedAt),
              if (list.isEmpty) const EmptyState(icon: Icons.event_seat_outlined, title: 'No upcoming exams'),
              for (final s in list)
                Card(
                  margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(s['title'] as String, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                      const SizedBox(height: 2),
                      Text('${fmtDate(s['date'] as String)} · ${s['startTime']} · ${s['durationMin']} min · ${(s['modules'] as List).map((m) => m['code']).join(', ')}', style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 12),
                      if (s['seat'] == null)
                        const Text('Seating not yet released for this session.', style: TextStyle(color: Colors.grey))
                      else ...[
                        Builder(builder: (context) {
                          final seat = s['seat'] as Map<String, dynamic>;
                          final v = seat['venue'] as Map<String, dynamic>;
                          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Icon(Icons.event_seat, color: Theme.of(context).colorScheme.primary),
                              const SizedBox(width: 8),
                              Text('${v['name']} · ${seat['seatLabel']}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Theme.of(context).colorScheme.primary)),
                            ]),
                            Text('${v['building']} · row ${seat['row']}, column ${seat['col']}', style: Theme.of(context).textTheme.bodySmall),
                            const SizedBox(height: 12),
                            MiniSeatGrid(
                              rows: v['rows'] as int,
                              cols: v['cols'] as int,
                              disabled: ((v['disabledSeats'] as List?) ?? []).cast<Map<String, dynamic>>(),
                              row: seat['row'] as int,
                              col: seat['col'] as int,
                            ),
                          ]);
                        }),
                      ],
                    ]),
                  ),
                ),
            ]),
          );
        },
      ),
    );
  }
}
