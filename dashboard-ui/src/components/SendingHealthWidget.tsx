import React from 'react';
import { Link } from 'react-router-dom';
import { useSenderStatus } from '@/hooks/useSenderStatus';
import { Loading } from '@/components/ui/Loading';
import {
  CheckCircle,
  AlertTriangle,
  ShieldAlert,
  AlertCircle,
} from 'lucide-react';
import {
  EnvelopeIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';

interface SendingHealthWidgetProps {
  totalComplaints: number;
  complaintRate: number;
  bounceRate: number;
  senderStatus: 'healthy' | 'warning' | 'critical';
}

export const SendingHealthWidget: React.FC<SendingHealthWidgetProps> = ({
  totalComplaints,
  complaintRate,
  bounceRate,
  senderStatus: deliverabilityStatus,
}) => {
  const senderStatus = useSenderStatus();
  const formatPct = (v: number) => `${v.toFixed(2)}%`;

  const getDeliverabilityConfig = () => {
    switch (deliverabilityStatus) {
      case 'healthy':
        return { icon: CheckCircle, color: 'text-success-600', bg: 'bg-success-50', border: 'border-success-200', label: 'Healthy' };
      case 'warning':
        return { icon: AlertTriangle, color: 'text-warning-600', bg: 'bg-warning-50', border: 'border-warning-200', label: 'Warning' };
      case 'critical':
        return { icon: ShieldAlert, color: 'text-error-600', bg: 'bg-error-50', border: 'border-error-200', label: 'Critical' };
    }
  };

  const getSenderIcon = () => {
    if (senderStatus.hasFailed) return <ExclamationTriangleIcon className="w-4 h-4 text-error-500" />;
    if (senderStatus.hasTimedOut || senderStatus.hasUnverified) return <ClockIcon className="w-4 h-4 text-warning-500" />;
    if (senderStatus.verifiedCount === senderStatus.totalCount && senderStatus.totalCount > 0) return <CheckCircleIcon className="w-4 h-4 text-success-500" />;
    return <EnvelopeIcon className="w-4 h-4 text-muted-foreground" />;
  };

  const getSenderSummary = () => {
    if (senderStatus.totalCount === 0) return 'No senders configured';
    if (senderStatus.hasFailed) return `${senderStatus.failedCount} failed verification`;
    if (senderStatus.hasTimedOut) return `${senderStatus.timedOutCount} expired`;
    if (senderStatus.hasUnverified) return `${senderStatus.pendingCount} pending`;
    return `${senderStatus.verifiedCount} verified`;
  };

  const config = getDeliverabilityConfig();
  const StatusIcon = config.icon;
  const isHighComplaint = complaintRate > 0.1;

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base sm:text-lg font-medium text-foreground">Sending Health</h3>
        <div className={`p-1.5 rounded-full ${config.bg}`}>
          <StatusIcon className={`w-4 h-4 ${config.color}`} />
        </div>
      </div>

      {/* Deliverability metrics */}
      <div className="space-y-2.5 mb-3">
        <div className="flex justify-between items-center">
          <span className="text-xs sm:text-sm text-muted-foreground">Complaint Rate</span>
          <span className={`text-xs sm:text-sm font-medium ${isHighComplaint ? 'text-error-600' : 'text-foreground'}`}>
            {formatPct(complaintRate)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs sm:text-sm text-muted-foreground">Bounce Rate</span>
          <span className={`text-xs sm:text-sm font-medium ${bounceRate > 5 ? 'text-error-600' : bounceRate > 2 ? 'text-warning-600' : 'text-foreground'}`}>
            {formatPct(bounceRate)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs sm:text-sm text-muted-foreground">Complaints</span>
          <span className="text-xs sm:text-sm font-medium text-foreground">{totalComplaints}</span>
        </div>
      </div>

      {/* Sender status - compact */}
      <div className="pt-3 border-t border-border">
        {senderStatus.loading ? (
          <div className="flex items-center justify-center py-2">
            <Loading size="sm" />
          </div>
        ) : senderStatus.error ? (
          <div className="text-xs text-muted-foreground">Unable to load sender status</div>
        ) : (
          <Link
            to="/senders"
            className="flex items-center justify-between group"
            aria-label="View sender email status"
          >
            <div className="flex items-center gap-2">
              {getSenderIcon()}
              <span className="text-xs sm:text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                {getSenderSummary()}
              </span>
            </div>
            <ArrowRightIcon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Link>
        )}
      </div>
    </div>
  );
};

export default SendingHealthWidget;
