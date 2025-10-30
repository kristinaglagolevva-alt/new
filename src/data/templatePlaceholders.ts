export interface TemplatePlaceholder {
  key: string;
  token: string;
  label: string;
  category?: string;
  description?: string;
}

export const TEMPLATE_PLACEHOLDERS: TemplatePlaceholder[] = [
  {
    key: 'actNumber',
    token: '${actNumber}',
    label: 'Номер акта',
    category: 'Акты',
    description: 'Номер акта сдачи-приемки, например «12/2024».',
  },
  {
    key: 'startPeriodDate',
    token: '${startPeriodDate}',
    label: 'Начало отчетного периода',
    category: 'Акты',
  },
  {
    key: 'endPeriodDate',
    token: '${endPeriodDate}',
    label: 'Конец отчетного периода',
    category: 'Акты',
  },
  {
    key: 'date',
    token: '${date}',
    label: 'Дата документа',
    category: 'Акты',
    description: 'Текущая дата в формате «дд.мм.гггг».',
  },
  {
    key: 'companyName',
    token: '${companyName}',
    label: 'Название заказчика',
    category: 'Заказчик',
  },
  {
    key: 'companyInn',
    token: '${companyInn}',
    label: 'ИНН заказчика',
    category: 'Заказчик',
  },
  {
    key: 'seoFullName',
    token: '${seoFullName}',
    label: 'ФИО руководителя заказчика',
    category: 'Заказчик',
  },
  {
    key: 'seoShortName',
    token: '${seoShortName}',
    label: 'Подпись руководителя заказчика',
    category: 'Заказчик',
    description: 'Фамилия и инициалы для подписи.',
  },
  {
    key: 'seoPosition',
    token: '${seoPosition}',
    label: 'Должность руководителя',
    category: 'Заказчик',
  },
  {
    key: 'seoAuthority',
    token: '${seoAuthority}',
    label: 'Основание полномочий',
    category: 'Заказчик',
    description: 'Например, «действующего на основании Устава».',
  },
  {
    key: 'responsiblePerson',
    token: '${responsiblePerson}',
    label: 'Ответственный сотрудник',
    category: 'Заказчик',
  },
  {
    key: 'contractorCompanyName',
    token: '${contractorCompanyName}',
    label: 'Название исполнителя',
    category: 'Исполнитель',
  },
  {
    key: 'contractorSeoFullName',
    token: '${contractorSeoFullName}',
    label: 'ФИО руководителя исполнителя',
    category: 'Исполнитель',
  },
  {
    key: 'contractorseoShortName',
    token: '${contractorseoShortName}',
    label: 'Подпись руководителя исполнителя',
    category: 'Исполнитель',
  },
  {
    key: 'employeeName',
    token: '${employeeName}',
    label: 'ФИО исполнителя',
    category: 'Исполнитель',
  },
  {
    key: 'employeeContractNumber',
    token: '${employeeContractNumber}',
    label: 'Номер договора с исполнителем',
    category: 'Исполнитель',
  },
  {
    key: 'employeeContractDate',
    token: '${employeeContractDate}',
    label: 'Дата договора с исполнителем',
    category: 'Исполнитель',
  },
  {
    key: 'appendixName',
    token: '${appendixName}',
    label: 'Название приложения',
    category: 'Служебное задание',
  },
  {
    key: 'assignmentGoal',
    token: '${assignmentGoal}',
    label: 'Цель задания',
    category: 'Служебное задание',
  },
  {
    key: 'assignmentPurpose',
    token: '${assignmentPurpose}',
    label: 'Назначение разработки',
    category: 'Служебное задание',
  },
  {
    key: 'assignmentBasis',
    token: '${assignmentBasis}',
    label: 'Основание для разработки',
    category: 'Служебное задание',
  },
  {
    key: 'assignmentRequirements',
    token: '${assignmentRequirements}',
    label: 'Требования к разработке',
    category: 'Служебное задание',
  },
  {
    key: 'assignmentAppendix',
    token: '${assignmentAppendix}',
    label: 'Содержимое приложения',
    category: 'Служебное задание',
  },
  {
    key: 'deadlineDate',
    token: '${deadlineDate}',
    label: 'Срок выполнения задания',
    category: 'Служебное задание',
  },
  {
    key: 'bodygpt',
    token: '${bodygpt}',
    label: 'Детализация работ',
    category: 'Служебное задание',
    description: 'Основной текст с описанием работ или задач.',
  },
  {
    key: 'orderNumber',
    token: '${orderNumber}',
    label: 'Номер приказа',
    category: 'Приказы',
  },
  {
    key: 'orderDate',
    token: '${orderDate}',
    label: 'Дата приказа',
    category: 'Приказы',
  },
  {
    key: 'orderNumber1',
    token: '${orderNumber1}',
    label: 'Номер приказа №1',
    category: 'Приказы',
  },
  {
    key: 'orderDate1',
    token: '${orderDate1}',
    label: 'Дата приказа №1',
    category: 'Приказы',
  },
  {
    key: 'orderNumber2',
    token: '${orderNumber2}',
    label: 'Номер приказа №2',
    category: 'Приказы',
  },
  {
    key: 'orderDate2',
    token: '${orderDate2}',
    label: 'Дата приказа №2',
    category: 'Приказы',
  },
  {
    key: 'softwareName',
    token: '${softwareName}',
    label: 'Название программного продукта',
    category: 'Продукт',
  },
  {
    key: 'softwareCustomer',
    token: '${softwareCustomer}',
    label: 'Заказчик программного продукта',
    category: 'Продукт',
  },
  {
    key: 'softwareFunctionality',
    token: '${softwareFunctionality}',
    label: 'Функциональность программного продукта',
    category: 'Продукт',
  },
  {
    key: 'programmingLanguage',
    token: '${programmingLanguage}',
    label: 'Язык разработки',
    category: 'Продукт',
  },
  {
    key: 'projectSystemName',
    token: '${projectSystemName}',
    label: 'Система управления проектами',
    category: 'Инфраструктура',
  },
  {
    key: 'repositorySystem',
    token: '${repositorySystem}',
    label: 'Система репозиториев',
    category: 'Инфраструктура',
  },
  {
    key: 'devServer',
    token: '${devServer}',
    label: 'Сервер разработки',
    category: 'Инфраструктура',
  },
  {
    key: 'gitlabServer',
    token: '${gitlabServer}',
    label: 'Сервер GitLab',
    category: 'Инфраструктура',
  },
  {
    key: 'table1',
    token: '${table1}',
    label: 'Таблица: перечень работ',
    category: 'Таблицы',
  },
  {
    key: 'table2',
    token: '${table2}',
    label: 'Таблица: репозитории',
    category: 'Таблицы',
  },
  {
    key: 'tasksTable',
    token: '${tasksTable}',
    label: 'Таблица задач',
    category: 'Таблицы',
  },
  {
    key: 'appTasksTable',
    token: '${appTasksTable}',
    label: 'Таблица задач (акт передачи прав)',
    category: 'Таблицы',
  },
  {
    key: 'repositoryTableRows',
    token: '${repositoryTableRows}',
    label: 'Таблица репозиториев',
    category: 'Таблицы',
    description: 'Список серверов/репозиториев для передачи программного обеспечения.',
  },
  {
    key: 'orderReferencesList',
    token: '${orderReferencesList}',
    label: 'Ссылки на приказы',
    category: 'Таблицы',
    description: 'Сформированный список приказов с номерами и датами.',
  },
  {
    key: 'totalAmountNumeric',
    token: '${totalAmountNumeric}',
    label: 'Сумма цифрами',
    category: 'Финансы',
  },
  {
    key: 'totalAmountWords',
    token: '${totalAmountWords}',
    label: 'Сумма прописью',
    category: 'Финансы',
  },
  {
    key: 'vatAmountNumeric',
    token: '${vatAmountNumeric}',
    label: 'НДС цифрами',
    category: 'Финансы',
  },
  {
    key: 'vatAmountWords',
    token: '${vatAmountWords}',
    label: 'НДС прописью',
    category: 'Финансы',
  },
];

export const TEMPLATE_PLACEHOLDER_MAP: Record<string, TemplatePlaceholder> = Object.fromEntries(
  TEMPLATE_PLACEHOLDERS.map((placeholder) => [placeholder.key, placeholder])
) as Record<string, TemplatePlaceholder>;
