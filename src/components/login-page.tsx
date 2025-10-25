import { FormEvent, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { useAuth } from '../data/AuthContext';

export function LoginPage() {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось выполнить вход';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-screen w-full overflow-y-auto flex items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl text-center">Войти в систему</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : null}
            <Button type="submit" className="w-full" disabled={isSubmitting || loading}>
              {isSubmitting || loading ? 'Входим…' : 'Войти'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Используйте учетные данные из раздела &ldquo;Настройки → Пользователи&rdquo;. Демо-доступ: admin@example.com / admin123
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
