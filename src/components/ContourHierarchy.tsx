import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Building2, ChevronRight, Users, Lock } from 'lucide-react';

export function ContourHierarchy() {
  return (
    <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-600" />
          Иерархия контуров
        </CardTitle>
        <CardDescription>
          Каждый уровень видит только свой контур и агрегированные данные подчинённых
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Level 1: Client */}
          <div className="bg-white rounded-lg p-4 border-2 border-blue-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-900">Альфа-Банк</span>
                  <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Заказчик</Badge>
                </div>
                <div className="text-xs text-gray-600">
                  Видит: сводную аналитику подрядчиков (задачи, прогресс, акты)
                </div>
              </div>
              <Lock className="w-4 h-4 text-gray-400" />
            </div>

            {/* Level 2: Contractor */}
            <div className="ml-8 pt-3 border-l-2 border-blue-200 pl-4 space-y-3">
              <div className="bg-white rounded-lg p-4 border-2 border-green-300">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-900">Компания B</span>
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Подрядчик</Badge>
                    </div>
                    <div className="text-xs text-gray-600">
                      Видит: свои проекты + агрегированные данные субподрядчиков
                    </div>
                  </div>
                  <Lock className="w-4 h-4 text-gray-400" />
                </div>

                {/* Level 3: Subcontractor */}
                <div className="ml-8 pt-3 border-l-2 border-green-200 pl-4 space-y-3">
                  <div className="bg-white rounded-lg p-4 border-2 border-purple-300">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-gray-900">Компания C</span>
                          <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Субподрядчик</Badge>
                        </div>
                        <div className="text-xs text-gray-600">
                          Видит: только свои задачи, документы и исполнителей
                        </div>
                      </div>
                      <Lock className="w-4 h-4 text-gray-400" />
                    </div>

                    {/* Level 4: Employees */}
                    <div className="ml-8 pt-2 border-l-2 border-purple-200 pl-4">
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="flex items-center gap-2 text-sm">
                          <Users className="w-4 h-4 text-gray-500" />
                          <span className="text-gray-700">Исполнители</span>
                          <Badge variant="secondary" className="text-xs">Работники</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-100 rounded-lg p-4 text-sm">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-blue-700 flex-shrink-0 mt-0.5" />
              <div className="text-blue-900">
                <strong className="block mb-1">Принцип изоляции:</strong>
                <ul className="space-y-1 text-blue-800 text-xs">
                  <li>• Альфа НЕ видит компанию C напрямую, только агрегированные показатели через B</li>
                  <li>• Компания B НЕ видит данные других подрядчиков Альфы</li>
                  <li>• Компания C изолирована от всех, кроме своего заказчика (B)</li>
                  <li>• Каждый контур — это отдельный "мир" с собственными проектами и документами</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
