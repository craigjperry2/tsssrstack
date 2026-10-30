import type { FC } from 'hono/jsx';
export const Auth: FC<{ mode: 'login' | 'register'; error?: string }> = ({ mode, error }) => (
  <>
    <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
    {error && (
      <p role='alert' data-variant='danger' class='mb-4'>
        {error}
      </p>
    )}
    <form class='mb-6' method='post' action={`/${mode}`}>
      <div data-field>
        <label htmlFor='email'>Email</label>
        <input id='email' required type='email' name='email' autoComplete='email' />
      </div>
      <div data-field>
        <label htmlFor='password'>Password</label>
        <input
          id='password'
          required
          type='password'
          name='password'
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </div>
      <button type='submit'>{mode === 'login' ? 'Sign in' : 'Register'}</button>
    </form>
    <p>
      <a href={mode === 'login' ? '/register' : '/login'}>
        {mode === 'login' ? 'Create an account' : 'Already have an account?'}
      </a>
    </p>
  </>
);
