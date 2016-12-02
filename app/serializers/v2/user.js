import { pick } from 'lodash';

const commonUserFields = [
  'id',
  'username',
  'screenName',
  'isPrivate',
  'isProtected',
  'isVisibleToAnonymous',
  'createdAt',
  'updatedAt',
  'type',
  'profilePictureLargeUrl',
  'profilePictureMediumUrl',
];

const commonGroupFields = [
  ...commonUserFields,
  'isRestricted',
];

const selfUserFields = [
  ...commonUserFields,
  'description',
  'email',
  'frontendPreferences',
  'privateMeta',
];

export async function serializeSelfUser(user) {
  const result = pick(user, selfUserFields);

  [
    result.banIds,
    result.pendingGroupRequests,
    result.unreadDirectsNumber,
    result.statistics,
  ] = await Promise.all([
    user.getBanIds(),
    user.getPendingGroupRequests(),
    user.getUnreadDirectsNumber(),
    user.getStatistics(),
  ]);

  return result;
}

export function serializeUser(user) {
  return pick(user, user.type === 'group' ? commonGroupFields : commonUserFields);
}