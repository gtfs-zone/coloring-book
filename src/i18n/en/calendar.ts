/** Service calendar, in English. */
export const calendar = {
  'svc.loadFailed': 'Failed to load service editor',
  'svc.dayFailed': 'Failed to update {day}',
  'svc.addExceptionFailed': 'Failed to add exception',
  'svc.weeklyPattern': 'Weekly Pattern',
  'svc.dateRange': 'Date Range',
  'svc.exceptions': 'Service Exceptions',
  'svc.renameNeedsRow':
    'Only a service with a calendar.txt row can be renamed. Toggle a weekday to create one.',
  'svc.noCalendarRow':
    'This service has no calendar.txt row, so it has no date range. Its dates come from the exceptions below. Toggle a weekday to create one.',
  'svc.exceptionsUnavailable':
    'Exceptions cannot be edited until the edit history is ready.',
  'svc.added': 'Added service',
  'svc.removed': 'Removed service',
  'svc.noAdded': 'No dates add service beyond the weekly pattern.',
  'svc.noRemoved': 'No dates remove service from the weekly pattern.',
  'svc.enterDate': 'Enter a date as YYYYMMDD',
  'svc.setRangeFirst': 'Set a start and end date first',
  'svc.holidaysInRange_one':
    '{count} federal holiday date falls in this date range',
  'svc.holidaysInRange_other':
    '{count} federal holiday dates fall in this date range',
  'svc.excludeHolidays': 'Exclude US Federal Holidays',
  'svc.setRangeBeforeHolidays':
    'Set a start and end date before excluding holidays',
  'svc.includeHolidaysLabel': 'Include US federal holidays',
  'svc.excludeHolidaysLabel': 'Exclude US federal holidays',
  'svc.holidaysFailed': 'Failed to update federal holidays',
  'timeline.noData': 'No service data available',
  'timeline.noDates': 'No date data available',
  'timeline.addedOn': 'Added {date}',
  'timeline.removedOn': 'Removed {date}',
  'timeline.editService': 'Edit service {id}',
  'timeline.clickRow': 'Click the row to open the service',
  'timeline.truncated': 'Date range exceeds 3 years: display truncated.',
  'timeline.hint':
    'Select a service to show the timetable for that service, or use the pencil to edit the service itself.',
  'timeline.trips': 'Trips',
  'cal.feedStart': 'Feed start date',
  'cal.feedEnd': 'Feed end date',
  'cal.title': 'Service Calendar',
  'cal.monthGrid': 'Month Grid',
  'cal.timeline': 'Timeline',
  'newSvc.title': 'New service',
  'newSvc.idHasExceptions':
    'calendar_dates already has exceptions for service "{id}"',
  'newSvc.needsDates': 'A service needs both a start and an end date.',
  'newSvc.endBeforeStart': 'The end date is before the start date.',
  'newSvc.created': 'Created service {id}',
} as const;
