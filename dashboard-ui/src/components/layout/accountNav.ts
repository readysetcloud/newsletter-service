import {
  EnvelopeIcon,
  KeyIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline';
import { UserIcon as UserSolidIcon } from '@heroicons/react/24/solid';

export interface AccountItem {
  name: string;
  href: string;
  icon: React.FC<{ className?: string }>;
  adminOnly?: boolean;
}

export const ACCOUNT_ITEMS: AccountItem[] = [
  { name: 'Profile', href: '/profile', icon: UserSolidIcon },
  { name: 'Sender Emails', href: '/senders', icon: EnvelopeIcon },
  { name: 'API Keys', href: '/api-keys', icon: KeyIcon },
  { name: 'Billing', href: '/billing', icon: CreditCardIcon, adminOnly: true },
];
