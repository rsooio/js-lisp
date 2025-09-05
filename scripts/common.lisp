;; 通用函数

(define (map fn list)
  (define (iter list result)
    (if (null? list) result
      (iter (cdr list) (cons (fn (car list)) result))))
  (iter list '()))

(define (some pred? list)
  (list.some (function pred?)))

(define (add a b) (+ a b))
(add 1 2)

(sleep 1000)
(display "sleep 1s done")

(define (some a) (+ a 1))

(get (list 1 2 3) "some")

((get (list 1 3) "some") (λ (x) (= x 2)))
((get (list 1 2 3) "map") (λ (x) (= x 1)))

(some (λ (x) (= x 2)) (list 1 3))
(some (λ (x) (= x 2)) (list 1 2 3))
(not ((λ (x) (== x 2)) 2))

(define (watchdog ms (fn (λ ())))
  (define ref (object (list "dead" #f)))
  (define (kill)
    (#clear-timeout (get ref "timer"))
    (set ref "dead" #t)
    (fn))
  (define (feed)
    (when (not (get ref "dead"))
      (#clear-timeout (get ref "timer"))
      (set ref "timer" (#timeout ms (kill)))))
  (define (dead) (get ref "dead"))
  (feed)
  (object
    (list "feed" feed)
    (list "dead" dead)
    (list "kill" kill)))


(define (join sep . list) (call (object-ref list "join") sep))
(define (replace search replace str)
        (call (object-ref str "replace") search replace))
(define (startswith pattern str) (call (get str "startsWith") pattern))
(define (endswith pattern str) (call (get str "endsWith") pattern))
(define (split sep str)
        (call (object-ref str "split") sep))
(define (trim str)
        (call (object-ref str "trim")))
(define (includes item iterable)
        (call (get iterable "includes") item))

;; Playwright 封装
(define (goto url) (call (object-ref page "goto") url))

(define (select text) (call (object-ref page "$") text))
(define (select-all text) (call (object-ref page "$$") text))
(define (locator selector) (call (object-ref page "locator") selector))
(define (first locator) (call (object-ref locator "first")))
(define (locator-first selector) (first (locator selector)))
(define (get-by-text text) (call (object-ref page "getByText") text))
(define (get-by-exact-text text) (call (object-ref page "getByText") text (object (list "exact" #t))))
(define (get-by-placeholder text) (call (object-ref page "getByPlaceholder") text))

(define (count locator)
        (call (get locator "count")))
(define (fill text locator) (call (object-ref locator "fill") text))
(define (press-sequentially locator text #:delay (delay 0) #:timeout (timeout 5000))
  (call (get locator "pressSequentially") text (object (list "delay" delay "timeout" timeout))))
(define (press key locator)
  (call (object-ref locator "press") key))
(define (click locator) (call (object-ref locator "click")))
(define (force-click locator) (call (object-ref locator "click" (object (list "force" #t)))))
(define (set-input-files file locator) (call (object-ref locator "setInputFiles") file))
(define (get-attribute name locator) (call (object-ref locator "getAttribute") name))
(define (wait-for-selector selector #:timeout (timeout 5000))
        (call (object-ref page "waitForSelector") selector (object (list "timeout" timeout))))
(define (wait-for locator #:timeout (timeout 5000))
        (call (object-ref locator "waitFor") (object (list "timeout" timeout))))
(define (wait-for-url url #:timeout (timeout 5000))
        (call (object-ref page "waitForURL") url (object (list "timeout" timeout))))
(define (inner-text locator #:timeout (timeout 5000))
        (call (object-ref locator "innerText") (object (list "timeout" timeout))))




(define (keyboard-press key) (call (object-ref page "keyboard" "press") key))
(define (keyboard-type text #:delay (delay 0))
  (call (object-ref page "keyboard" "type") text (object (list "delay" delay))))
