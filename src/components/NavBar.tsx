import { Icon } from './Icon';
import { route, switchTab, unreadChats, type Tab } from '../lib/store';

/* Same five destinations as the Android bottom bar, using its own icons. */
const TABS: { tab: Tab; icon: string; label: string }[] = [
  { tab: 'home', icon: 'ic_navbar_home', label: 'Home' },
  { tab: 'discover', icon: 'ic_navbar_search', label: 'Discover' },
  { tab: 'create', icon: 'ic_navbar_create', label: 'Create' },
  { tab: 'inbox', icon: 'ic_navbar_inbox', label: 'Inbox' },
  { tab: 'profile', icon: 'ic_navbar_profile', label: 'Profile' },
];

export function NavBar() {
  const current = route.value.name === 'tab' ? route.value.tab : null;

  return (
    <nav class="navbar" aria-label="Main">
      {TABS.map(({ tab, icon, label }) => {
        const active = current === tab;
        const badge = tab === 'inbox' ? unreadChats.value : 0;
        return (
          <button
            key={tab}
            class={`nav-item${active ? ' is-active' : ''}`}
            onClick={() => switchTab(tab)}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
          >
            <span class="nav-icon">
              <Icon name={icon} size={tab === 'create' ? 26 : 22} />
              {badge > 0 && <span class="nav-badge">{badge > 99 ? '99+' : badge}</span>}
            </span>
            <span class="nav-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
