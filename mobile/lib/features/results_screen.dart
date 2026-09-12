import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/data.dart';
import '../widgets/common.dart';

class ResultsScreen extends ConsumerWidget {
  const ResultsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(profileProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My results')),
      body: q.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(message: e.toString(), onRetry: () => ref.invalidate(profileProvider)),
        data: (c) {
          final p = c.data as Map<String, dynamic>;
          final sems = (p['semesters'] as List).cast<Map<String, dynamic>>();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(profileProvider),
            child: ListView(children: [
              StaleBanner(stale: c.stale, syncedAt: c.syncedAt),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text('${p['student']['programme']['code']} · Intake ${p['student']['intake']['label']} · standing ${p['student']['standing']}', style: Theme.of(context).textTheme.bodySmall),
              ),
              if (sems.isEmpty) const EmptyState(icon: Icons.school_outlined, title: 'No enrolments yet'),
              for (final s in sems)
                ExpansionTile(
                  initiallyExpanded: s == sems.last,
                  title: Text('Semester ${s['number']}'),
                  subtitle: Text('${s['summary']['passed']} passed · ${s['summary']['resit']} resit · ${s['summary']['pending']} pending'),
                  children: [
                    for (final m in (s['modules'] as List).cast<Map<String, dynamic>>())
                      ListTile(
                        title: Text('${m['module']['code']} · ${m['module']['title']}'),
                        subtitle: Text(m['result'] == null
                            ? 'Awaiting publication'
                            : 'Overall ${(m['result']['overallMark'] as num).toStringAsFixed(1)} · attempt ${m['attempt']}${m['isResit'] == true ? ' (resit)' : ''}${m['result']['version'] > 1 ? ' · corrected' : ''}'),
                        trailing: m['result'] == null
                            ? const Icon(Icons.hourglass_empty, color: Colors.grey)
                            : Pill('${m['result']['grade']} · ${m['result']['outcome']}', color: outcomeColor(m['result']['outcome'] as String?)),
                      ),
                  ],
                ),
            ]),
          );
        },
      ),
    );
  }
}
