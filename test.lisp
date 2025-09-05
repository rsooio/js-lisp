;(define (map fn arr)
;        (cond (((null? arr) null)
;               (else (cons (fn (car arr)) (map fn (cdr arr)))))))

;(define (test a #:test [test 666] (x 123) . b)
;        (display a b test x))

;(test 1)

;(wait-for-selector "img[src*='aweme-avatar']")
;(object (list "avatar" (get-attribute "src" (locator-first "img[src*='aweme-avatar']")))
;        (list "nickname" (inner-text (locator-first "xpath=//div[contains(text(), '抖音号：')]/preceding-sibling::div[2]"))))

(define test "query visionProfileReduced($userId: String) {
  visionProfileReduced(userId: $userId) {
    result
    hostName
    userProfile {
      profile {
        gender
        user_name
        user_id
        headurl
        user_text
        user_profile_bg_url
        __typename
      }
      isFollowing
      isUserIsolated
      livingInfo
      __typename
    }
    __typename
  }
}")

;(call (get (call (get page.context)) "storageState") 
  ;(dict #:path "C:\\Users\\Admin\\workspace\\js-lisp\\storage.json"))

;(define (on-response resp)
  ;(define url (call (get resp.url)))
  ;(define paths (call (get url.split) "/"))
  ;(display paths))

;(define cb-response (callback (resp) (on-response resp)))
;(call (get page.on) "response" cb-response)

(define a 123)
(define (b) 456)

;(log a (b) (+ a (b)))

;(display (== (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(log (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(log (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(display (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(display (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(log (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(log (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(display (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))
;(display (equal? (dict #:a 1 #:b (list 2 3)) (dict #:b (list 2 3) #:a 1)))

(display 
  ((get (JS.RegExp "^\\d{3}-\\d{8}|\\d{4}-\\d{7}$") "test") "010-12345678"))