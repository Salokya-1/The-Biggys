import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../widgets/common.dart';

const _roleLabel = {
  'ADMIN': 'RTE Admin',
  'MODULE_LEADER': 'Module Leader',
  'LECTURER': 'Lecturer',
  'STUDENT': 'Student',
};

final threadsProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return await ref.watch(apiProvider).get('/api/messages/threads') as List<dynamic>;
});

/// Who you have talked to, and a search to find somebody you have not.
///
/// The same flat model as the web: a conversation is the messages between two people, so this
/// screen is a list, a search box and a thread. Nothing is held open — it polls while a thread is
/// on screen and stops when it is not, which keeps the phone and the free instance both quiet.
class MessagesScreen extends ConsumerStatefulWidget {
  const MessagesScreen({super.key});
  @override
  ConsumerState<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends ConsumerState<MessagesScreen> {
  final _search = TextEditingController();
  List<dynamic> _found = [];
  bool _searching = false;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onSearchChanged(String q) {
    _debounce?.cancel();
    if (q.trim().length < 2) {
      setState(() => _found = []);
      return;
    }
    // A request per keystroke is how a search box becomes the heaviest screen in the app.
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      setState(() => _searching = true);
      try {
        final res = await ref.read(apiProvider).get('/api/messages/people?q=${Uri.encodeQueryComponent(q.trim())}') as List<dynamic>;
        if (mounted) setState(() => _found = res);
      } on ApiException {
        if (mounted) setState(() => _found = []);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final threads = ref.watch(threadsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Messages'), actions: const [AppBarLogo()]),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _search,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: 'Name, email or student ID',
                border: const OutlineInputBorder(),
                suffixIcon: _searching
                    ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)))
                    : _search.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _search.clear();
                              setState(() => _found = []);
                            },
                          ),
              ),
            ),
          ),
          Expanded(
            child: _found.isNotEmpty
                ? ListView.builder(
                    itemCount: _found.length,
                    itemBuilder: (context, i) {
                      final p = _found[i] as Map<String, dynamic>;
                      final sub = [
                        _roleLabel[p['role']] ?? p['role'],
                        if (p['studentId'] != null) p['studentId'],
                        if (p['programme'] != null) p['programme'],
                      ].join(' · ');
                      return ListTile(
                        leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                        title: Text(p['name'] as String, overflow: TextOverflow.ellipsis),
                        subtitle: Text(sub, overflow: TextOverflow.ellipsis),
                        onTap: () => _open(context, p['id'] as String, p['name'] as String),
                      );
                    },
                  )
                : threads.when(
                    loading: () => const Center(child: CircularProgressIndicator()),
                    error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('$e', textAlign: TextAlign.center))),
                    data: (items) => items.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(32),
                              child: Column(mainAxisSize: MainAxisSize.min, children: [
                                Icon(Icons.forum_outlined, size: 44, color: Theme.of(context).colorScheme.outline),
                                const SizedBox(height: 12),
                                const Text('No conversations yet'),
                                const SizedBox(height: 4),
                                Text('Search for somebody above.', style: Theme.of(context).textTheme.bodySmall),
                              ]),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: () async => ref.invalidate(threadsProvider),
                            child: ListView.separated(
                              itemCount: items.length,
                              separatorBuilder: (_, _) => const Divider(height: 1),
                              itemBuilder: (context, i) {
                                final t = items[i] as Map<String, dynamic>;
                                final unread = (t['unread'] as num?)?.toInt() ?? 0;
                                return ListTile(
                                  leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                                  title: Text(t['name'] as String, overflow: TextOverflow.ellipsis),
                                  subtitle: Text(t['last'] as String, maxLines: 1, overflow: TextOverflow.ellipsis),
                                  trailing: unread > 0 ? Badge(label: Text('$unread')) : null,
                                  onTap: () => _open(context, t['id'] as String, t['name'] as String),
                                );
                              },
                            ),
                          ),
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _open(BuildContext context, String id, String name) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(personId: id, personName: name)));
    ref.invalidate(threadsProvider);
    if (mounted) {
      _search.clear();
      setState(() => _found = []);
    }
  }
}

/// One conversation.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.personId, required this.personName});
  final String personId;
  final String personName;
  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _draft = TextEditingController();
  final _scroll = ScrollController();
  List<dynamic> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    // Polled rather than pushed: a socket held open on a free instance costs more than a small
    // request every twenty seconds, and only while this screen is actually in front of somebody.
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    _draft.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final res = await ref.read(apiProvider).get('/api/messages/with/${widget.personId}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _messages = res['messages'] as List<dynamic>;
        _loading = false;
        _error = null;
      });
      _toBottom();
    } on ApiException catch (e) {
      if (!mounted || quiet) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send() async {
    final text = _draft.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiProvider).post('/api/messages', body: {'toId': widget.personId, 'body': text});
      _draft.clear();
      await _load(quiet: true);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(widget.personName, overflow: TextOverflow.ellipsis)),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
                    : _messages.isEmpty
                        ? Center(child: Text('Nothing yet. Say something.', style: Theme.of(context).textTheme.bodySmall))
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.all(12),
                            itemCount: _messages.length,
                            itemBuilder: (context, i) {
                              final m = _messages[i] as Map<String, dynamic>;
                              final mine = m['mine'] == true;
                              return Align(
                                alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                                child: Container(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                                  decoration: BoxDecoration(
                                    color: mine ? scheme.primary : scheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    m['body'] as String,
                                    style: TextStyle(color: mine ? scheme.onPrimary : scheme.onSurface),
                                  ),
                                ),
                              );
                            },
                          ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    controller: _draft,
                    minLines: 1,
                    maxLines: 4,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    decoration: const InputDecoration(hintText: 'Write a message', border: OutlineInputBorder()),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(onPressed: _sending ? null : _send, icon: const Icon(Icons.send)),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}
