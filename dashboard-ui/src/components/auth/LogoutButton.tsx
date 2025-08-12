import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

interface LogoutButtonProps {
  className?: string;
  showText?: boolean;
  variant?: 'button' | 'menu-item';
}

export function LogoutButton({
  className = '',
  showText = true,
  variant = 'button'
}: LogoutButtonProps) {
  const { signOut, isLoading } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleLogout = async () => {
    try {
      setIsSigningOut(true);
      await signOut();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsSigningOut(false);
    }
  };

  const baseClasses = variant === 'menu-item'
    ? 'flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900'
    : 'inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500';

  const isDisabled = isLoading || isSigningOut;

  return (
    <button
      onClick={handleLogout}
      disabled={isDisabled}
      className={`${baseClasses} ${className} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {isSigningOut ? (
        <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : (
        <ArrowRightOnRectangleIcon className="h-4 w-4 mr-2" />
      )}
      {showText && (isSigningOut ? 'Signing Out...' : 'Sign Out')}
    </button>
  );
}
