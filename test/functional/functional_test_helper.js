import fetch from 'node-fetch'
import request  from 'superagent'
import _ from 'lodash'
import SocketIO from 'socket.io-client';

import { dbAdapter } from '../../app/models'
import { getSingleton as initApp } from '../../app/app'


const apiUrl = async (relativeUrl) => {
  const app = await initApp()
  return `${app.config.host}${relativeUrl}`
}

export function createUser(username, password, attributes, callback) {
  return function(done) {
    if (typeof attributes === 'function') {
      callback = attributes
      attributes = {}
    }

    if (typeof attributes === 'undefined')
      attributes = {}

    var user = {
      username: username,
      password: password
    }
    if (attributes.email)
      user.email = attributes.email

    apiUrl('/v1/users').then(url => {
      request
        .post(url)
        .send(user)
        .end(function(err, res) {
          if (callback) {
            var luna = res.body.users
            luna.password = user.password
            callback(res.body.authToken, luna)
          }
          done()
        })
    })
  }
}

export function createUserCtx(context, username, password, attrs) {
  return createUser(username, password, attrs, function(token, user) {
    context.user      = user
    context.authToken = token
    context.username  = username.toLowerCase()
    context.password  = password
    context.attributes = attrs
  })
}

export function subscribeToCtx(context, username) {
  return function(done) {
    apiUrl(`/v1/users/${username}/subscribe`).then(url => {
      request
        .post(url)
        .send({ authToken: context.authToken })
        .end(function(err, res) {
          done(err, res)
        })
    })
  }
}

export function updateUserCtx(context, attrs) {
  return function(done) {
    apiUrl(`/v1/users/${context.user.id}`).then(url => {
      request
        .post(url)
        .send({ authToken: context.authToken,
          user: { email: attrs.email },
          '_method': 'put' })
        .end(function(err, res) {
          done(err, res)
        })
    })
  }
}

export function resetPassword(token) {
  return function(done) {
    apiUrl(`/v1/passwords/${token}`).then(url => {
      request
        .post(url)
        .send({ '_method': 'put' })
        .end(function(err, res) {
          done(err, res)
        })
    })
  }
}

export function createPost(context, body, callback) {
  return function(done) {
    apiUrl('/v1/posts').then(url => {
      request
        .post(url)
        .send({ post: { body: body }, meta: { feeds: context.username }, authToken: context.authToken })
        .end(function(err, res) {
          context.post = res.body.posts
          if (typeof callback !== 'undefined')
            callback(context.post)

          done(err, res)
        })
    })
  }
}

export function createPostWithCommentsDisabled(context, body, commentsDisabled) {
  return postJson('/v1/posts', {
    post: { body: body },
    meta: { feeds: context.username, commentsDisabled: commentsDisabled },
    authToken: context.authToken
  })
}

export function createPostForTest(context, body, callback) {
  apiUrl('/v1/posts').then(url => {
    request
      .post(url)
      .send({ post: { body: body }, meta: { feeds: context.username }, authToken: context.authToken })
      .end(function(err, res) {
        context.post = res.body.posts
        callback(err, res)
      })
  })
}

export function createComment(body, postId, authToken, callback) {
  return function(done) {
    apiUrl('/v1/comments').then(url => {
      var comment = {
        body: body,
        postId: postId
      }

      request
        .post(url)
        .send({ comment: comment, authToken: authToken })
        .end(function(err, res) {
          done(err, res)
        })
    })
  }(callback)
}

export function createCommentCtx(context, body) {
  return function(done) {
    apiUrl('/v1/comments').then(url => {
      var comment = {
        body: body,
        postId: context.post.id
      }

      request
        .post(url)
        .send({comment: comment, authToken: context.authToken})
        .end(function (err, res) {
          context.comment = res.body.comments
          done(err, res)
        })
    })
  }
}

export function removeComment(commentId, authToken, callback) {
  return function(done) {
    apiUrl(`/v1/comments/${commentId}`).then(url => {
      request
        .post(url)
        .send({
          authToken: authToken,
          '_method': 'delete'
        })
        .end(function(err, res) {
          done(err, res)
        })
    })
  }(callback)
}

export function removeCommentAsync(context, commentId) {
  return postJson(
    `/v1/comments/${commentId}`,
    {
      authToken: context.authToken,
      '_method': 'delete'
    }
  )
}

export function getTimeline(timelinePath, authToken, callback) {
  return function(done) {
    apiUrl(timelinePath).then(url => {
      var sendParams = {};

      if (authToken) {
        sendParams.authToken = authToken
      }

      request
        .get(url)
        .query(sendParams)
        .end(function(err, res) {
          done(err, res)
        })
    })
  }(callback)
}

export function getTimelinePaged(timelinePath, authToken, offset, limit, callback) {
  return function(done) {
    apiUrl(timelinePath).then(url => {
      var sendParams = {};

      if (!_.isUndefined(authToken)) {
        sendParams.authToken = authToken
      }

      if (!_.isUndefined(offset)) {
        sendParams.offset = offset
      }

      if (!_.isUndefined(limit)) {
        sendParams.limit = limit
      }

      request
        .get(url)
        .query(sendParams)
        .end(function(err, res) {
          done(err, res)
        })
    })
  }(callback)
}

export function getSubscribers(username, authToken, callback) {
  return function(done) {
    let sendParams = {};
    if (authToken) {
      sendParams.authToken = authToken
    }

    apiUrl(`/v1/users/${username}/subscribers`).then(url => {
      request
        .get(url)
        .query(sendParams)
        .end(function(err, res) {
          done(err, res)
        })
    })
  }(callback)
}

export async function getSubscribersAsync(username, userContext){
  const relativeUrl = `/v1/users/${username}/subscribers`
  let url = await apiUrl(relativeUrl)

  if (!_.isUndefined(userContext)) {
    let encodedToken = encodeURIComponent(userContext.authToken)
    url = `${url}?authToken=${encodedToken}`
  }

  return fetch(url)
}

export function getSubscriptions(username, authToken, callback) {
  return function(done) {
    let sendParams = {};
    if (authToken) {
      sendParams.authToken = authToken
    }

    apiUrl(`/v1/users/${username}/subscriptions`).then(url => {
      request
        .get(url)
        .query(sendParams)
        .end(function(err, res) {
          done(err, res)
        })
    })
  }(callback)
}

async function postJson(relativeUrl, data) {
  return fetch(
    await apiUrl(relativeUrl),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }
  )
}

export async function createUserAsyncPost(user) {
  return postJson(`/v1/users`, user)
}

export async function createUserAsync(username, password, attributes) {
  if (typeof attributes === 'undefined') {
    attributes = {}
  }

  let user = {
    username,
    password
  }

  if (attributes.email) {
    user.email = attributes.email
  }

  let response = await createUserAsyncPost(user)
  let data = await response.json()

  let userData = data.users
  userData.password = password

  return {
    authToken: data.authToken,
    user: userData,
    username: username.toLowerCase(),
    password,
    attributes
  }
}

export function whoami(authToken) {
  return postJson(
    '/v1/users/whoami',
    {
      authToken: authToken,
      '_method': 'get'
    }
  )
}

export function like(postId, authToken) {
  return postJson(`/v1/posts/${postId}/like`, { authToken })
}

export function unlike(postId, authToken) {
  return postJson(`/v1/posts/${postId}/unlike`, { authToken })
}

export function updateUserAsync(userContext, user) {
  return postJson(
    `/v1/users/${userContext.user.id}`,
    {
      authToken: userContext.authToken,
      user,
      '_method': 'put'
    }
  )
}

export function updateGroupAsync(group, adminContext, groupData) {
  return postJson(
    `/v1/users/${group.id}`,
    {
      authToken: adminContext.authToken,
      user: groupData,
      '_method': 'put'
    }
  )
}

export function getUserAsync(context, username) {
  return postJson(
    `/v1/users/${username}`,
    {
      authToken: context.authToken,
      '_method': 'get'
    }
  )
}

export function goPrivate(userContext) {
  return updateUserAsync(userContext, { isPrivate: "1" });
}

export function goPublic(userContext) {
  return updateUserAsync(userContext, { isPrivate: "0" });
}

export function groupToPrivate(group, userContext) {
  return updateGroupAsync(group, userContext, { isPrivate: "1" });
}

export function subscribeToAsync(subscriber, victim) {
  return postJson(`/v1/users/${victim.username}/subscribe`, {authToken: subscriber.authToken})
}

export async function mutualSubscriptions(userContexts) {
  let promises = []

  for (let ctx1 of userContexts) {
    for (let ctx2 of userContexts) {
      if (ctx1.username == ctx2.username) {
        continue
      }

      promises.push(exports.subscribeToAsync(ctx1, ctx2))
    }
  }

  await Promise.all(promises)
}

export async function createAndReturnPostToFeed(feed, userContext, body) {
  let response = await postJson(
    '/v1/posts',
    {
      post: {body},
      meta: {feeds: feed.username},
      authToken: userContext.authToken
    }
  )

  let data = await response.json()

  return data.posts
}

export function createAndReturnPost(userContext, body) {
  return createAndReturnPostToFeed(userContext, userContext, body)
}

export function createCommentAsync (userContext, postId, body) {
  return postJson('/v1/comments', {comment: {body, postId}, authToken: userContext.authToken})
}

const getTimelineAsync = async (relativeUrl, userContext) => {
  let url = await apiUrl(relativeUrl)

  if (!_.isUndefined(userContext)) {
    let encodedToken = encodeURIComponent(userContext.authToken)
    url = `${url}?authToken=${encodedToken}`
  }

  let response = await fetch(url)
  let data = await response.json()

  return data
}

export function getUserFeed(feedOwnerContext, readerContext) {
  return getTimelineAsync(`/v1/timelines/${feedOwnerContext.username}`, readerContext)
}

export function getUserLikesFeed(feedOwnerContext, readerContext) {
  return getTimelineAsync(`/v1/timelines/${feedOwnerContext.username}/likes`, readerContext)
}

export function getUserCommentsFeed(feedOwnerContext, readerContext) {
  return getTimelineAsync(`/v1/timelines/${feedOwnerContext.username}/comments`, readerContext)
}

export function getRiverOfNews(userContext) {
  return getTimelineAsync('/v1/timelines/home', userContext)
}

export function getMyDiscussions(userContext) {
  return getTimelineAsync('/v1/timelines/filter/discussions', userContext)
}

export function sendResetPassword(email) {
  return postJson('/v1/passwords', { email })
}

export async function readPostAsync(postId, userContext) {
  let relativeUrl = `/v1/posts/${postId}?maxComments=all`
  let url = await apiUrl(relativeUrl)

  if (!_.isUndefined(userContext)) {
    let encodedToken = encodeURIComponent(userContext.authToken)
    url = `${url}&authToken=${encodedToken}`
  }

  return fetch(url)
}

export function disableComments(postId, authToken) {
  return postJson(`/v1/posts/${postId}/disableComments`, { authToken })
}

export function enableComments(postId, authToken) {
  return postJson(`/v1/posts/${postId}/enableComments`, { authToken })
}

export async function createPostViaBookmarklet(userContext, title, comment, image, feeds) {
  const parameters = {
    authToken: userContext.authToken,
    title,
    comment: comment ? comment : '',
    image: ''
  }

  if (image) {
    throw new Error('Attachments support is not implemented in test-helper for Bookmarklet-requests')
  }

  // we do not fill "meta" always, as older clients do not do this
  if (feeds) {
    parameters.meta = { feeds }
  }

  return postJson(`/v1/bookmarklet`, parameters)
}

export async function createMockAttachmentAsync(context) {
  let attachmentId
  const params = {
    fileName: 'lion.jpg',
    fileSize: 12345,
    userId: context.user.id,
    postId: '',
    createdAt: (new Date()).getTime(),
    updatedAt: (new Date()).getTime()
  }

  attachmentId = await dbAdapter.createAttachment(params)

  return {
    id: attachmentId,
    ...params
  }
}

export function updatePostAsync(context, post) {
  return postJson(
    `/v1/posts/${context.post.id}`,
    {
      authToken: context.authToken,
      post,
      '_method': 'put'
    }
  )
}

export function deletePostAsync(context, postId) {
  return postJson(
    `/v1/posts/${postId}`,
    {
      authToken: context.authToken,
      '_method': 'delete'
    }
  )
}

export async function createGroupAsync(context, username, screenName) {
  let params = {
    group: {
      username: username,
      screenName: screenName || username
    },
    authToken: context.authToken
  }

  let response = await postJson(`/v1/groups`, params)
  let data = await response.json()

  return {
    group: data.groups,
    username: username
  }
}

export function promoteToAdmin(group, existingAdminContext, potentialAdminContext) {
  return postJson(
    `/v1/groups/${group.username}/subscribers/${potentialAdminContext.user.username}/admin`,
    {authToken: existingAdminContext.authToken}
  )
}

export function sendRequestToJoinGroup(subscriber, group) {
  return postJson(`/v1/groups/${group.username}/sendRequest`, {authToken: subscriber.authToken})
}

export function banUser(who, whom) {
  return postJson(`/v1/users/${whom.username}/ban`, { authToken: who.authToken })
}

/**
 * Async-friendly wrapper around Socket.IO client.
 * Convenient for testing
 */
const PromisifiedIO = (host, options, events) => {
  return new Promise((resolve, reject) => {
    try {
      const client = SocketIO.connect(host, options)

      client.on('error', reject);
      client.on('connect_error', reject);

      client.on('disconnect', () => {
        if ('disconnect' in events) {
          try {
            events.disconnect();
          } catch (e) {
            // do nothing
          }
        }
        resolve();
      });

      for (const k of Object.keys(events)) {
        if (k === 'disconnect') {
          continue;
        }

        client.on(k, (...args) => {
          try {
            args.push(client);
            const result = events[k](...args);
            if (result instanceof Promise) {
              result.catch(e => { reject(e); })
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    } catch (e) {
      reject(e);
    }
  });
}

export async function createRealtimeConnection(context, callbacks) {
  const app = await initApp()

  const port = (process.env.PEPYATKA_SERVER_PORT || app.get('port'));
  const options = {
    transports: ['websocket'],
    'force new connection': true,
    query: `token=${context.authToken}`
  };

  return PromisifiedIO(`http://localhost:${port}/`, options, callbacks);
}
