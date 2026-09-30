import { accountHandlers } from './accounts'
import { adminHandlers } from './admin'
import { authHandlers } from './auth'
import { customerHandlers } from './customers'
import { fieldHandlers } from './field'
import { insightHandlers } from './insights'
import { loanHandlers } from './loans'
import { operationHandlers } from './operations'
import { organisationHandlers } from './organisation'
import { transferHandlers } from './transfers'

export const handlers = [
  ...authHandlers,
  ...adminHandlers,
  ...organisationHandlers,
  ...customerHandlers,
  ...accountHandlers,
  ...loanHandlers,
  ...fieldHandlers,
  ...operationHandlers,
  ...transferHandlers,
  ...insightHandlers,
]
