import type { FC } from 'hono/jsx';
export const Auth: FC<{ mode: 'login' | 'register'; error?: string }> = ({ mode, error }) => (
  <>
    <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
    {error && <p role='alert'>{error}</p>}
    <form method='post' action={`/${mode}`}>
      <label>
        Email<input required type='email' name='email' autoComplete='email' />
      </label>
      <label>
        Password<input
          required
          type='password'
          name='password'
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </label>
      <button type='submit'>{mode === 'login' ? 'Sign in' : 'Register'}</button>
    </form>
    <p>
      <a href={mode === 'login' ? '/register' : '/login'}>
        {mode === 'login' ? 'Create an account' : 'Already have an account?'}
      </a>
    </p>
  </>
);
