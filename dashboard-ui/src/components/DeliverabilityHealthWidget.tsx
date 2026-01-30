import { AlertCircle, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';

interface DeliverabilityHealthWidgetProps {
  totalComplaints: number;
  complaintRate: number;
  bounceRate: number;
  senderStatus: 'healthy' | 'warning' | 'critical';
}

export default function DeliverabilityHealthWidget({
  totalComplaints,
  complaintRate,
  bounceRate,
  senderStatus
}: DeliverabilityHealthWidgetProps) {
  const formatPercentage = (value: number) => `${value.toFixed(2)}%`;

  const getStatusConfig = () => {
    switch (senderStatus) {
      case 'healthy':
        return {
          icon: CheckCircle,
          color: 'text-success-600',
          bgColor: 'bg-success-50',
          borderColor: 'border-success-200',
          label: 'Healthy',
          description: 'Your sender reputation is good'
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          color: 'text-warning-600',
          bgColor: 'bg-warning-50',
          borderColor: 'border-warning-200',
          label: 'Warning',
          description: 'Monitor your deliverability metrics'
        };
      case 'critical':
        return {
          icon: ShieldAlert,
          color: 'text-error-600',
          bgColor: 'bg-error-50',
          borderColor: 'border-error-200',
          label: 'Critical',
          description: 'Immediate attention required'
        };
    }
  };

  const statusConfig = getStatusConfig();
  const StatusIcon = statusConfig.icon;

  const isHighComplaintRate = complaintRate > 0.1;

  return (
    <div className="bg-surface rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h3 className="text-base sm:text-lg font-medium text-foreground">Deliverability Health</h3>
        <div className={`p-1.5 sm:p-2 rounded-full ${statusConfig.bgColor}`}>
          <StatusIcon className={`w-4 h-4 sm:w-5 sm:h-5 ${statusConfig.color}`} />
        </div>
      </div>

      <div className={`mb-3 sm:mb-4 p-2.5 sm:p-3 rounded-md border ${statusConfig.borderColor} ${statusConfig.bgColor}`}>
        <div className="flex items-center">
          <StatusIcon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${statusConfig.color} mr-2 flex-shrink-0`} />
          <div className="min-w-0">
            <div className={`text-xs sm:text-sm font-medium ${statusConfig.color}`}>
              {statusConfig.label}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {statusConfig.description}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 sm:space-y-4">
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs sm:text-sm text-muted-foreground">Complaints</span>
            <span className="text-xs sm:text-sm font-medium text-foreground">{totalComplaints}</span>
          </div>
          <div className="flex items-center flex-wrap gap-1">
            <div className="text-xs text-muted-foreground">Rate: {formatPercentage(complaintRate)}</div>
            {isHighComplaintRate && (
              <div className="flex items-center">
                <AlertCircle className="w-3 h-3 text-error-500 mr-1" />
                <span className="text-xs text-error-600 font-medium">High</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs sm:text-sm text-muted-foreground">Bounce Rate</span>
            <span className="text-xs sm:text-sm font-medium text-foreground">{formatPercentage(bounceRate)}</span>
          </div>
          <div className="mt-1 w-full bg-muted rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                bounceRate > 5 ? 'bg-error-600' : bounceRate > 2 ? 'bg-warning-600' : 'bg-success-600'
              }`}
              style={{ width: `${Math.min(bounceRate * 10, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-border">
        <div className="text-xs text-muted-foreground">
          Keep complaint rate below 0.1% and bounce rate below 5% for optimal deliverability.
        </div>
      </div>
    </div>
  );
}
