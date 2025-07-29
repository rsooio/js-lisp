;(define (map fn arr)
;        (cond (((null? arr) null)
;               (else (cons (fn (car arr)) (map fn (cdr arr)))))))

(define (test a #:test [test 666] (x 123) . b)
        (display a b test x))

(test 1)