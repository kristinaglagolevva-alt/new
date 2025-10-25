import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Alert, AlertDescription } from './ui/alert';
import { CheckCircle, AlertCircle, FileText, ArrowRight, ExternalLink } from 'lucide-react';

type ChecklistStatus = 'completed' | 'warning' | 'pending';
type ChecklistActionType = 'success' | 'warning' | 'primary' | 'default';

export interface ChecklistItem {
  id: string;
  title: string;
  status: ChecklistStatus;
  description: string;
  action: string;
  actionType?: ChecklistActionType;
  onAction?: () => void;
}

interface NextStepsBlockProps {
  items: ChecklistItem[];
  isLoading?: boolean;
}

const getStatusIcon = (status: ChecklistStatus) => {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    case 'warning':
      return <AlertCircle className="w-5 h-5 text-yellow-600" />;
    case 'pending':
    default:
      return <FileText className="w-5 h-5 text-blue-600" />;
  }
};

const getActionVariant = (
  actionType: ChecklistActionType | undefined,
): 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' => {
  switch (actionType) {
    case 'success':
      return 'default';
    case 'warning':
      return 'outline';
    case 'primary':
      return 'default';
    default:
      return 'outline';
  }
};

const SkeletonItem = () => (
  <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
    <div className="flex items-center gap-3">
      <div className="w-5 h-5 rounded-full bg-muted/40 animate-pulse" />
      <div className="space-y-2">
        <div className="h-4 w-40 bg-muted/40 rounded animate-pulse" />
        <div className="h-3 w-56 bg-muted/30 rounded animate-pulse" />
      </div>
    </div>
    <div className="h-8 w-28 bg-muted/30 rounded animate-pulse" />
  </div>
);

export function NextStepsBlock({ items, isLoading = false }: NextStepsBlockProps) {
  const totalItems = items.length;
  const completedItems = items.filter((item) => item.status === 'completed').length;
  const progressPercentage = totalItems === 0 ? 0 : (completedItems / totalItems) * 100;

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5" />
            Что дальше
          </CardTitle>
          <Badge variant="secondary">
            {completedItems} из {totalItems || '0'} выполнено
          </Badge>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Прогресс настройки</span>
            <span className="font-medium">{Math.round(progressPercentage)}%</span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {isLoading
            ? Array.from({ length: 3 }).map((_, index) => <SkeletonItem key={index} />)
            : items.length > 0
              ? items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(item.status)}
                      <div>
                        <h4 className="font-medium">{item.title}</h4>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                    <Button
                      variant={getActionVariant(item.actionType)}
                      size="sm"
                      className="gap-2"
                      onClick={item.onAction}
                      disabled={!item.onAction}
                    >
                      {item.action}
                      {item.status === 'completed' ? (
                        <ArrowRight className="w-4 h-4" />
                      ) : (
                        <ExternalLink className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                ))
              : (
                  <div className="flex items-center justify-center rounded-lg border bg-card py-8 text-sm text-muted-foreground">
                    Все основные шаги завершены. Продолжайте работу с документами.
                  </div>
                )}
        </div>

        <Alert className="mt-6">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            {completedItems === totalItems && totalItems > 0
              ? 'Все базовые шаги закрыты — можно переходить к формированию документов.'
              : 'Сначала завершите оставшиеся шаги, затем переходите к фильтрации задач и актам.'}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
