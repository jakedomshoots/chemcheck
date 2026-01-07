import { useState } from 'react';
import { UserButton, useClerk } from '@clerk/clerk-react';
import { 
  User, 
  Settings, 
  LogOut, 
  ChevronDown,
  Building2,
  Shield,
  HelpCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthContext } from './ClerkAuthProvider';
import { useNavigate } from 'react-router-dom';

export function UserMenu() {
  const auth = useAuthContext();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  // Always use Clerk's UserButton for the robust auth system
  if (auth?.clerkUser) {
    return (
      <UserButton 
        appearance={{
          elements: {
            avatarBox: 'w-9 h-9',
            userButtonPopoverCard: 'shadow-xl border-0',
            userButtonPopoverActionButton: 'hover:bg-slate-100 transition-colors',
            userButtonPopoverActionButtonText: 'text-slate-700',
            userButtonPopoverActionButtonIcon: 'text-slate-500',
            userButtonPopoverFooter: 'hidden' // Hide "Manage account" footer
          }
        }}
        afterSignOutUrl="/login"
        userProfileMode="navigation"
        userProfileUrl="/settings"
      />
    );
  }

  // Fallback for unauthenticated state
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigate('/login')}
      className="text-sm"
    >
      Sign In
    </Button>
  );
}

export default UserMenu;
