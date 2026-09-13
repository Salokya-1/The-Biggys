import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/data.dart';
import '../widgets/common.dart';

/// Staff queue: every mark sheet in the caller's scope, review states first.
class ApprovalsScreen extends ConsumerWidget {
  const ApprovalsScreen({super.key});

  static const _order = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DRAFT', 'CORRECTION_REQUESTED', 'PUBLISHED'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(sheetsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mark sheets'), actions: const [AppBarLogo()]),
      body: q.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(message: e.toString(), onRetry: () => ref.invalidate(sheetsProvider)),
        data: (c) {
          final list = (c.data as List).cast<Map<String, dynamic>>()..sort((a, b) => _order.indexOf(a['status'] as String).compareTo(_order.indexOf(b['status'] as String)));
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(sheetsProvider),
            child: ListView(children: [
              StaleBanner(stale: c.stale, syncedAt: c.syncedAt),
              if (list.isEmpty) const EmptyState(icon: Icons.fact_check_outlined, title: 'No mark sheets in your scope'),
              for (final s in list)
                ListTile(
                  title: Text('${s['moduleOffering']['module']['code']} · ${s['moduleOffering']['module']['title']}'),
                  subtitle: Text('${s['moduleOffering']['semester']['intake']['programme']['code']} ${s['moduleOffering']['semester']['intake']['label']} · Sem ${s['moduleOffering']['semester']['number']} · v${s['version']} · ${s['moduleOffering']['lecturer']?['name'] ?? 'no lecturer'}'),
                  trailing: Pill((s['status'] as String).replaceAll('_', ' '), color: statusColor(s['status'] as String)),
                  onTap: () => context.push('/sheet/${s['id']}'),
                ),
            ]),
          );
        },
      ),
    );
  }
}
