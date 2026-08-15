'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { isAuthConfigured } from '@/lib/amplify';

export function Providers({ children }: { children: React.ReactNode }) {
  if (!isAuthConfigured) {
    return (
      <div className="config-missing">
        <h1>Configuration required</h1>
        <p>
          Set the following environment variables in <code>.env.local</code> and restart the dev
          server:
        </p>
        <ul>
          <li>
            <code>NEXT_PUBLIC_API_URL</code>
          </li>
          <li>
            <code>NEXT_PUBLIC_COGNITO_USER_POOL_ID</code>
          </li>
          <li>
            <code>NEXT_PUBLIC_COGNITO_CLIENT_ID</code>
          </li>
        </ul>
      </div>
    );
  }

  return (
    <Authenticator.Provider>
      <Authenticator>{children}</Authenticator>
    </Authenticator.Provider>
  );
}
