import { Strategy as LocalStrategy } from 'passport-local';

import { dbAdapter } from '../../app/models';


export function init(passport) {
  passport.use(new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password'
  }, async (username, clearPassword, done) => {
    try {
      let user;

      if (username.indexOf('@') === -1) {
        user = await dbAdapter.getUserByUsername(username.trim());
      } else {
        user = await dbAdapter.getUserByEmail(username.trim());
      }

      if (!user) {
        // db inconsistency. got id, but didn't find object
        done({ message: 'We could not find the nickname you provided.' });
        return;
      }

      const valid = await user.validPassword(clearPassword);

      if (!valid) {
        done({ message: 'The password you provided does not match the password in our system.' });
        return;
      }

      done(null, user);
    } catch (e) {
      done({ message: 'We could not find the nickname you provided.' });
    }
  }));
}

