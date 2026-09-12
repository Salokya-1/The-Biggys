import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/auth.dart';
import 'approvals_screen.dart';
import 'exams_screen.dart';
import 'home_screen.dart';
import 'notifications_screen.dart';
import 'profile_screen.dart';
import 'results_screen.dart';
import 'timetable_screen.dart';

/// Bottom-navigation shell. Students and staff get different tabs.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});
  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider.select((s) => s.user));
    if (user == null) return const SizedBox.shrink();
    final student = user.isStudent;
    final tabs = student
        ? const [
            (icon: Icons.home_outlined, label: 'Home', screen: HomeScreen()),
            (icon: Icons.calendar_month_outlined, label: 'Timetable', screen: TimetableScreen()),
            (icon: Icons.school_outlined, label: 'Results', screen: ResultsScreen()),
            (icon: Icons.event_seat_outlined, label: 'Exams', screen: ExamsScreen()),
            (icon: Icons.person_outline, label: 'Profile', screen: ProfileScreen()),
          ]
        : const [
            (icon: Icons.home_outlined, label: 'Home', screen: HomeScreen()),
            (icon: Icons.calendar_month_outlined, label: 'Timetable', screen: TimetableScreen()),
            (icon: Icons.fact_check_outlined, label: 'Sheets', screen: ApprovalsScreen()),
            (icon: Icons.notifications_outlined, label: 'Alerts', screen: NotificationsScreen()),
            (icon: Icons.person_outline, label: 'Profile', screen: ProfileScreen()),
          ];
    final i = _index.clamp(0, tabs.length - 1);
    return Scaffold(
      body: IndexedStack(index: i, children: tabs.map((t) => t.screen as Widget).toList()),
      bottomNavigationBar: NavigationBar(
        selectedIndex: i,
        onDestinationSelected: (v) => setState(() => _index = v),
        destinations: tabs.map((t) => NavigationDestination(icon: Icon(t.icon), label: t.label)).toList(),
      ),
    );
  }
}
