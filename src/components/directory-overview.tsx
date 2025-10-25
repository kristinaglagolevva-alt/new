import { ComponentType, SVGProps } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { CheckCircle2, AlertCircle, Plus, Upload, Download, FileSpreadsheet } from 'lucide-react';
import { motion } from 'motion/react';

interface OverviewCard {
  id: string;
  title: string;
  current: number;
  total: number;
  status: 'complete' | 'incomplete';
  remaining?: number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  color: 'blue' | 'green';
}

interface DirectoryOverviewProps {
  cards: OverviewCard[];
  notes?: string[];
  onAdd: (id: string) => void;
  onSelect: (id: string) => void;
  onExportExcel: () => void;
  onTriggerUpload: () => void;
  onImportChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

export function DirectoryOverview({
  cards,
  notes = [],
  onAdd,
  onSelect,
  onExportExcel,
  onTriggerUpload,
  onImportChange,
  fileInputRef,
}: DirectoryOverviewProps) {
  return (
    <div className="space-y-6 mb-8">
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card, index) => {
          const Icon = card.icon;
          const percentage = card.total > 0 ? Math.round((card.current / card.total) * 100) : 0;
          const isComplete = card.status === 'complete';

          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card
                className="relative overflow-hidden border-2 hover:shadow-lg transition-all duration-300 group cursor-pointer"
                style={{
                  borderColor: isComplete ? '#10b981' : '#3b82f6',
                }}
                onClick={() => onSelect(card.id)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}
                        style={{
                          backgroundColor: isComplete ? '#10b981' : '#3b82f6',
                        }}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-gray-900 mb-1">{card.title}</h3>
                        <p className="text-sm text-gray-600">
                          {card.current} из {card.total}
                        </p>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdd(card.id);
                      }}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Готовность</span>
                      <span className="font-medium">{percentage}%</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                    
                    {!isComplete && card.remaining !== undefined && (
                      <div className="flex items-center gap-2 text-sm text-orange-600 mt-3">
                        <AlertCircle className="w-4 h-4" />
                        <span>Осталось заполнить: {card.remaining}</span>
                      </div>
                    )}

                    {isComplete && (
                      <div className="flex items-center gap-2 text-sm text-green-600 mt-3">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Все заполнено</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Notes Section */}
      {notes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-blue-900 mb-2">Дополните данные для полной готовности</h3>
                  <ul className="space-y-1">
                    {notes.map((note, index) => (
                      <li key={index} className="text-sm text-blue-700">
                        • {note}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Excel Buffer Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <FileSpreadsheet className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h3 className="text-gray-900 mb-1">Excel буфер</h3>
                  <p className="text-sm text-gray-600">
                    Выгрузите текущие данные для массового редактирования или загрузите обновлённый файл обратно
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={onImportChange}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={onTriggerUpload}
                >
                  <Upload className="w-4 h-4" />
                  Загрузить Excel
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={onExportExcel}
                >
                  <Download className="w-4 h-4" />
                  Выгрузить Excel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
