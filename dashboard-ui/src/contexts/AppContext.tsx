import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { AppState, UserState, NotificationState, UIState } from '@/types';

// Initial state
const initialUserState: UserState = {
  isAuthenticated: false,
  isLoading: false,
  profile: null,
  error: null,
};

const initialNotificationState: NotificationState = {
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,
};

const initialUIState: UIState = {
  sidebarOpen: false,
  theme: 'light',
  loading: {},
  errors: {},
};

const initialState: AppState = {
  user: initialUserState,
  notifications: initialNotificationState,
  ui: initialUIState,
};

// Action types
type AppAction =
  | { type: 'SET_USER_LOADING'; payload: boolean }
  | { type: 'SET_USER_ERROR'; payload: string | null }
  | { type: 'SET_AUTHENTICATED'; payload: boolean }
  | { type: 'SET_UI_LOADING'; payload: { key: string; loading: boolean } }
  | { type: 'SET_UI_ERROR'; payload: { key: string; error: string } }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_THEME'; payload: 'light' | 'dark' };

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_USER_LOADING':
      return {
        ...state,
        user: { ...state.user, isLoading: action.payload },
      };
    case 'SET_USER_ERROR':
      return {
        ...state,
        user: { ...state.user, error: action.payload },
      };
    case 'SET_AUTHENTICATED':
      return {
        ...state,
        user: { ...state.user, isAuthenticated: action.payload },
      };
    case 'SET_UI_LOADING':
      return {
        ...state,
        ui: {
          ...state.ui,
          loading: { ...state.ui.loading, [action.payload.key]: action.payload.loading },
        },
      };
    case 'SET_UI_ERROR':
      return {
        ...state,
        ui: {
          ...state.ui,
          errors: { ...state.ui.errors, [action.payload.key]: action.payload.error },
        },
      };
    case 'TOGGLE_SIDEBAR':
      return {
        ...state,
        ui: { ...state.ui, sidebarOpen: !state.ui.sidebarOpen },
      };
    case 'SET_THEME':
      return {
        ...state,
        ui: { ...state.ui, theme: action.payload },
      };
    default:
      return state;
  }
}

// Context
const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

// Provider component
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

// Custom hook to use the context
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
