import { useState, useEffect, useRef } from 'hono/jsx'
import type { JSX } from 'hono/jsx'

type AllowedInputTypes = 'password' | 'text' | 'number' | 'tel'

interface OTPInputProps {
  /** Number of OTP inputs to be rendered */
  length?: number
  /** Callback to be called when the OTP value changes */
  onChange: (value: string) => void
  /** Value of the OTP */
  value?: string
  /** Whether the first input should be auto focused */
  autoFocus?: boolean
  /** Placeholder for the inputs */
  placeholder?: string
  /** Input type */
  inputType?: AllowedInputTypes
  /** CSS class for the container */
  containerClass?: string
  /** CSS class for each input */
  inputClass?: string
  /** extra space after each "n" */
  inputsExtraSpace?: number
  /** extra space widt in px */
  extraSpaceWidth?: string
  /** Separator between inputs */
  separator?: string | JSX.IntrinsicElements['span']
  /** Disabled state */
  disabled?: boolean
}

/**
 * OTP Input Component for Hono JSX DOM
 */
export function OTPInput({
  length = 4,
  onChange,
  value = '',
  autoFocus = false,
  placeholder = '',
  inputType = 'text',
  containerClass = '',
  inputClass = '',
  inputsExtraSpace = 0,
  extraSpaceWidth = "1rem",
  separator = '',
  disabled = false
}: OTPInputProps) {
  // Convert value to array of digits
  const valueArray = value.split('').slice(0, length);
  
  // Fill the rest with empty strings
  while (valueArray.length < length) {
    valueArray.push('');
  }

  // State to track the current focused input index
  const [activeInput, setActiveInput] = useState(-1);
  
  // Refs for the input elements
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Prepare input references
  useEffect(() => {
    // Initialize the array if it doesn't exist
    if (!inputRefs.current) {
      inputRefs.current = [];
    }
    
    inputRefs.current = inputRefs.current.slice(0, length);
    
    // Auto focus the first input if needed
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [length, autoFocus]);

  // Handle value changes from parent component
  useEffect(() => {
    const newValueArray = value.split('').slice(0, length);
    
    // Fill the rest with empty strings
    while (newValueArray.length < length) {
      newValueArray.push('');
    }
    
    // Update input values
    if (inputRefs.current) {
      newValueArray.forEach((digit, i) => {
        if (inputRefs.current && inputRefs.current[i]) {
          inputRefs.current[i]!.value = digit;
        }
      });
    }
  }, [value, length]);

  // Check if input is valid (single digit for numbers, single char for text)
  const isInputValid = (input: string): boolean => {
    if (!input) return true;
    
    const isTypeValid = 
      (inputType === 'number' || inputType === 'tel') 
        ? !isNaN(Number(input)) 
        : typeof input === 'string';
    
    return isTypeValid && input.trim().length <= 1;
  };

  // Move focus to a specific input
  const focusInput = (index: number): void => {
    const newIndex = Math.max(0, Math.min(length - 1, index));
    
    if (inputRefs.current && inputRefs.current[newIndex]) {
      inputRefs.current[newIndex]!.focus();
      setActiveInput(newIndex);
    }
  };

  // Update OTP value
  const updateOTPValue = (index: number, newValue: string): void => {
    const newValueArray = [...valueArray];
    newValueArray[index] = newValue;
    onChange(newValueArray.join(''));
  };

  // Handle input change
  const handleChange = (e: Event, index: number): void => {
    const target = e.target as HTMLInputElement;
    const newValue = target.value;
    
    // If input is valid, update value and move to next input
    if (isInputValid(newValue)) {
      // Use the last character if multiple characters are entered
      const valueToUse = newValue.length > 0 ? newValue.slice(-1) : '';
      updateOTPValue(index, valueToUse);
      
      // Move to next input if there's a value
      if (valueToUse && index < length - 1) {
        focusInput(index + 1);
      }
    } else {
      // For pasted content that matches the length
      if (newValue.length === length) {
        // Check if all characters are valid
        const isValid = newValue.split('').every(char => {
          if (inputType === 'number' || inputType === 'tel') {
            return !isNaN(Number(char));
          }
          return true;
        });
        
        if (isValid) {
          onChange(newValue);
        } else {
          // Reset to current value
          target.value = valueArray[index] || '';
        }
      } else {
        // Reset to current value
        target.value = valueArray[index] || '';
      }
    }
  };

  // Handle key down events
  const handleKeyDown = (e: KeyboardEvent, index: number): void => {
    // Get key info
    const key = e.key;
    
    switch (key) {
      case 'Backspace':
        e.preventDefault();
        
        // If current input has value, clear it
        if (valueArray[index]) {
          updateOTPValue(index, '');
        } 
        // Otherwise move to previous input and clear it
        else if (index > 0) {
          focusInput(index - 1);
          updateOTPValue(index - 1, '');
        }
        break;
        
      case 'Delete':
        e.preventDefault();
        updateOTPValue(index, '');
        break;
        
      case 'ArrowLeft':
        e.preventDefault();
        focusInput(index - 1);
        break;
        
      case 'ArrowRight':
        e.preventDefault();
        focusInput(index + 1);
        break;
        
      case ' ':  // Space
      case 'Spacebar':
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        break;
        
      default:
        // For digit values, if the pressed key is the same as current value,
        // move to next input (without changing the value)
        if (key === valueArray[index] && index < length - 1) {
          e.preventDefault();
          focusInput(index + 1);
        }
        break;
    }
  };

  // Handle focus event
  const handleFocus = (index: number): void => {
    setActiveInput(index);
    // Select the text in the input
    if (inputRefs.current && inputRefs.current[index]) {
      inputRefs.current[index]!.select();
    }
  };

  // Handle paste event
  const handlePaste = (e: ClipboardEvent, index: number): void => {
    e.preventDefault();
    
    const pastedData = e.clipboardData?.getData('text/plain') || '';
    
    // Return if no data
    if (!pastedData) return;
    
    // For number inputs, check if pasted content is valid number
    if ((inputType === 'number' || inputType === 'tel') && 
        pastedData.split('').some(c => isNaN(Number(c)))) {
      return;
    }
    
    // Get characters we can paste (limit to remaining spaces)
    const chars = pastedData.slice(0, length - index).split('');
    
    // Create new value array with pasted characters
    const newValueArray = [...valueArray];
    
    let lastFilledIndex = index;
    
    // Fill in the values
    for (let i = 0; i < chars.length && index + i < length; i++) {
      newValueArray[index + i] = chars[i];
      lastFilledIndex = index + i;
    }
    
    // Update OTP
    onChange(newValueArray.join(''));
    
    // Focus the input after the last filled position
    setTimeout(() => {
      focusInput(Math.min(lastFilledIndex + 1, length - 1));
    }, 0);
  };

  return (
    <div class={`otp-container ${containerClass}`} style={{ display: 'flex', alignItems: 'center' }}>
      {Array.from({ length }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <input
            type= "text"
            inputMode={inputType === 'number' || inputType === 'tel' ? 'numeric' : 'text'}
            maxLength={1}
            value={valueArray[i]}
            autoComplete="off"
            style={{ marginRight: (i+1)%inputsExtraSpace==0 && i < length - 1 ? extraSpaceWidth : '0' }}
            class={`otp-input ${inputClass}`}
            ref={(el: HTMLInputElement | null) => {
              if (el && inputRefs.current) inputRefs.current[i] = el;
            }}
            disabled={disabled}
            placeholder={placeholder ? placeholder[i] || '' : ''}
            aria-label={`OTP digit ${i + 1}`}
            onFocus={() => handleFocus(i)}
            onChange={(e) => handleChange(e, i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            onPaste={(e) => handlePaste(e, i)}
          />
          {i < length - 1 && separator}
        </div>
      ))}
    </div>
  );
}
