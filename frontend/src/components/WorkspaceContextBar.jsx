'use client';

import GroupSelector from './GroupSelector';
import ServerFilterBar from './ServerFilterBar';

// Header dual-pane do dashboard de terminais. Em desktop, divide a row em
// metades para grupos e servers; em mobile, empilha as duas barras (grupos
// primeiro, servers depois). Os componentes filhos já mantêm seus próprios
// border-b/scroll horizontal — este wrapper só decide o layout.
export default function WorkspaceContextBar({
  groups,
  sessions,
  groupSessions,
  selectedGroupId,
  onSelectGroup,
  onHideGroup,
  onReorderGroups,
  onGroupsChanged,
  servers,
  selectedServerFilterId,
  onSelectServerFilter,
  serverHealth,
  onRetryServer,
  isMobile = false,
}) {
  // GroupSelector conta sessões por grupo (precisa de todas as sessões do
  // projeto). ServerFilterBar conta sessões por server *dentro do grupo
  // ativo* — é o número que faz sentido enquanto o usuário está navegando
  // dentro de um grupo específico. Fallback pra `sessions` mantém ServerBar
  // útil quando o caller não calcula sessionsInSelectedGroup separadamente.
  const groupBar = (
    <GroupSelector
      groups={groups}
      sessions={sessions}
      selectedGroupId={selectedGroupId}
      onSelect={onSelectGroup}
      onHideGroup={onHideGroup}
      onReorder={onReorderGroups}
      onGroupsChanged={onGroupsChanged}
      isMobile={isMobile}
      serverHealth={serverHealth}
    />
  );

  const showServerBar = servers.length > 0;
  const serverBar = showServerBar ? (
    <ServerFilterBar
      servers={servers}
      sessions={groupSessions ?? sessions}
      selectedServerId={selectedServerFilterId}
      onSelectServer={onSelectServerFilter}
      serverHealthById={serverHealth}
      onRetryServer={onRetryServer}
    />
  ) : null;

  if (isMobile) {
    return (
      <>
        {groupBar}
        {serverBar}
      </>
    );
  }

  if (!showServerBar) {
    return groupBar;
  }

  return (
    <div className="flex flex-shrink-0">
      <div
        className="flex-1 basis-1/2 min-w-0 border-r"
        style={{ borderColor: 'hsl(var(--sidebar-border))' }}
      >
        {groupBar}
      </div>
      <div className="flex-1 basis-1/2 min-w-0">
        {serverBar}
      </div>
    </div>
  );
}
