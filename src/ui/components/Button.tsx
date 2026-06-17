import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'default' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** Кнопка в стиле Auros. variant='primary' — единственный teal->cyan градиент (главное действие). */
export function Button({
  variant = 'default',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'ghost' && 'btn-ghost',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={cls} {...rest} />;
}
